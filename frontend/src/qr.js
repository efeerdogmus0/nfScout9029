import QRCode from "qrcode";

export async function buildQrDataUrl(payload) {
  const tsv = toTabSeparated(payload);
  const raw = btoa(unescape(encodeURIComponent(tsv)));
  return QRCode.toDataURL(raw, { errorCorrectionLevel: "M", margin: 1, width: 256 });
}

function toTabSeparated(payload) {
  const reports = payload.reports || [];
  const lines = ["match_key\tteam_key\thub_state\tscore_state\tt_ms\tx\ty\tmeta"];
  reports.forEach((report) => {
    const events = report.timeline || [];
    events.forEach((event) => {
      lines.push(
        [
          report.match_key || "",
          report.team_key || "",
          event.hub_state || "",
          event.action || "",
          event.t_ms || 0,
          event.x ?? "",
          event.y ?? "",
          event.meta || "",
        ].join("\t")
      );
    });
  });
  return lines.join("\n");
}
