"""Local SMTP transport acceptance; not a certification of external mail delivery."""

import re
from dataclasses import replace
from email import policy
from email.parser import BytesParser
from socketserver import StreamRequestHandler, TCPServer
from threading import Thread

from fastapi.testclient import TestClient

from chronofish.services.mail import SMTPMailer


def test_invitation_otp_password_login_and_logout_over_smtp(client):
    messages = []

    class SMTPHandler(StreamRequestHandler):
        def handle(self):
            self.wfile.write(b"220 localhost acceptance SMTP\r\n")
            while line := self.rfile.readline():
                command = line.split(b" ", 1)[0].strip().upper()
                if command in (b"EHLO", b"HELO", b"MAIL", b"RCPT", b"RSET"):
                    self.wfile.write(b"250 OK\r\n")
                elif command == b"DATA":
                    self.wfile.write(b"354 Send message\r\n")
                    body = []
                    while (line := self.rfile.readline()) not in (b".\r\n", b""):
                        body.append(line[1:] if line.startswith(b"..") else line)
                    messages.append(BytesParser(policy=policy.default).parsebytes(b"".join(body)))
                    self.wfile.write(b"250 Accepted\r\n")
                elif command == b"QUIT":
                    self.wfile.write(b"221 Bye\r\n")
                    return
                else:
                    self.wfile.write(b"502 Unsupported\r\n")

    with TCPServer(("127.0.0.1", 0), SMTPHandler) as server:
        worker = Thread(target=server.serve_forever, daemon=True)
        worker.start()
        auth = client.app.state.auth
        original = auth.mailer
        original_config = auth.config
        auth.config = replace(auth.config, mail_sender_email="sender@ku.th")
        auth.mailer = SMTPMailer(
            replace(
                auth.config,
                mail_smtp_host="127.0.0.1",
                mail_smtp_port=server.server_address[1],
                mail_sender_email="sender@ku.th",
                mail_smtp_username="",
                mail_use_ssl=False,
                mail_use_starttls=False,
            )
        )
        try:
            email = "smtp-acceptance@ku.th"
            invited = client.post("/api/v1/auth/admin/users", json={"email": email})
            assert invited.status_code == 201, invited.text
            assert messages and str(messages[-1]["To"]) == email
            body = {"email": email, "password": "acceptance password only"}
            with TestClient(client.app) as member:
                member.headers["X-Device-Id"] = "smtp-acceptance"
                assert member.post("/api/v1/auth/register", json=body).status_code == 202
                code = re.search(r"\b\d{6}\b", messages[-1].get_content()).group()
                verified = member.post("/api/v1/auth/verify-code", json={**body, "code": code})
                assert verified.status_code == 200, verified.text
                assert verified.json()["user"]["role"] == "member"
                assert member.post("/api/v1/auth/logout").status_code == 204
                assert member.get("/api/v1/auth/me").status_code == 401
                assert member.post("/api/v1/auth/login", json=body).status_code == 200
                assert member.get("/api/v1/auth/me").status_code == 200
        finally:
            auth.mailer = original
            auth.config = original_config
            server.shutdown()
            worker.join(timeout=5)
