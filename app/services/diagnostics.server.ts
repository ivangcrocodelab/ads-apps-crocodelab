type ErrorCode =
  | "ADS_REQUEST_FAILED"
  | "CLICK_REQUEST_FAILED"
  | "ADS_REFRESH_FAILED"
  | "CLICK_REFRESH_FAILED"
  | "PRODUCT_VERIFICATION_FAILED";

// Never pass exception messages, request URLs, tokens or shop identifiers here.
export function reportError(code: ErrorCode) {
  console.error(JSON.stringify({ event: "partner_ads_error", code }));
}
