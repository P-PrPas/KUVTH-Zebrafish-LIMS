"""Exercise nginx forwarding trust using disposable containers, without app data."""
import ipaddress
import json
from pathlib import Path
import subprocess
import tempfile
import uuid

ROOT = Path(__file__).resolve().parents[1]
IMAGE = "vetku-frontend:latest"


def docker(*args):
    return subprocess.check_output(["docker", *args], text=True).strip()


def main():
    prefix = "vetku-trust-" + uuid.uuid4().hex[:8]
    containers = []
    network = docker("network", "create", prefix)
    try:
        config = json.loads(docker("network", "inspect", network))[0]
        subnet = ipaddress.ip_network(config["IPAM"]["Config"][0]["Subnet"])
        server_ip, edge_ip, caller_ip = [str(subnet[i]) for i in (10, 11, 12)]
        with tempfile.TemporaryDirectory(dir=ROOT / ".tmp", prefix="proxy-trust-") as temp:
            folder = Path(temp)
            for role, address in (("edge", edge_ip), ("caller", caller_ip)):
                name = prefix + "-" + role
                docker("run", "-d", "--name", name, "--network", network, "--ip", address,
                       "--entrypoint", "sleep", IMAGE, "300")
                containers.append(name)
            for trust in ("unix:", edge_ip):
                server = (ROOT / "frontend/default.conf").read_text().replace(
                    "${TRUSTED_PROXY_IP}", trust).replace("${API_UPSTREAM}", "127.0.0.1")
                server = server.replace("    listen 8080;", "    listen 8080;\n"
                    "    location = /__ip { return 200 '$remote_addr'; }")
                (folder / "server.conf").write_text(server)
                base = (ROOT / "frontend/nginx.conf").read_text().replace(
                    "include /tmp/nginx/conf.d/*.conf;", "include /test/server.conf;")
                (folder / "nginx.conf").write_text(base)
                name = prefix + "-server"
                docker("run", "-d", "--name", name, "--network", network, "--ip", server_ip,
                       "-v", f"{folder}:/test:ro", "--entrypoint", "nginx", IMAGE,
                       "-c", "/test/nginx.conf", "-g", "daemon off;")
                containers.append(name)
                docker("exec", name, "nginx", "-t", "-c", "/test/nginx.conf")
                for role, address in (("edge", edge_ip), ("caller", caller_ip)):
                    observed = docker("exec", prefix + "-" + role, "wget", "-qO-",
                                      "--header=X-Real-IP: 198.51.100.77", f"http://{server_ip}:8080/__ip")
                    expected = "198.51.100.77" if trust == edge_ip and role == "edge" else address
                    assert observed == expected, (trust, role, observed, expected)
                    print(f"trust={trust}, source={role}: {observed} PASS")
                docker("rm", "-f", name)
                containers.remove(name)
    finally:
        for name in reversed(containers):
            docker("rm", "-f", name)
        docker("network", "rm", network)


if __name__ == "__main__":
    main()
