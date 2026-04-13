import QRCode from "qrcode";

export async function buildQrDataUrl(payload) {
  const raw = JSON.stringify(payload);
  return QRCode.toDataURL(raw, { errorCorrectionLevel: "M", margin: 1, width: 256 });
}
