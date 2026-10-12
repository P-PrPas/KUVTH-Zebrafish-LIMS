export type Notice = { message: string; tone: "success" | "danger" | "warning" };

export function saveNotice(result: Record<string, unknown>, label?: string): Notice {
  const th = document.documentElement.lang !== "en";
  const rejected = Array.isArray(result.results) ? result.results.filter((row) => row?.status === "rejected") : [];
  if (rejected.length)
    return {
      tone: "danger",
      message: `${th ? "บันทึกไม่สำเร็จ" : "Save failed"}: ${rejected.length} ${th ? "รายการ" : "item(s)"} — ${rejected.map((row) => row.error?.message ?? (th ? "ข้อมูลถูกปฏิเสธ" : "Record rejected")).join(" · ")}`,
    };
  return { tone: "success", message: th ? `บันทึก${label ?? "ข้อมูล"}สำเร็จ` : `${label ?? "Record"} saved successfully.` };
}

export function notify(message: string, tone: Notice["tone"] = "success") {
  const th = document.documentElement.lang !== "en";
  if (message === "OPERATOR_REQUIRED")
    message = th ? "กรุณาเลือกผู้ปฏิบัติงานก่อนบันทึก" : "Choose a recording operator before saving.";
  if (message === "AUTHENTICATION_REQUIRED") message = th ? "กรุณาเข้าสู่ระบบก่อนบันทึก" : "Sign in before saving.";
  window.dispatchEvent(new CustomEvent<Notice>("chronofish:notice", { detail: { message, tone } }));
}
