export const GUEST_NAME_PLACEHOLDER = "Guest";
export const GUEST_REGISTER_FORM_REQUEST_EVENT = "trikeserve:guest-register-form-request";

export function requestGuestRegisterForm(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(GUEST_REGISTER_FORM_REQUEST_EVENT));
}

export function guestNeedsName(name: string | null | undefined): boolean {
  const normalizedName = name?.trim();
  return !normalizedName || normalizedName.toLocaleLowerCase() === GUEST_NAME_PLACEHOLDER.toLocaleLowerCase();
}
