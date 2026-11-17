// The desk password is a 4-number code (like a phone PIN).
// Shared by the server (setup / change password) and the lock screen.

export const PASSWORD_LENGTH = 4;
export const PASSWORD_RE = /^\d{4}$/;
export const PASSWORD_RULE = 'Use exactly 4 numbers.';

export const isValidPassword = (pw: string) => PASSWORD_RE.test(pw);
