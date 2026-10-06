export const unavailable = {
  error: {
    code: "SECRET_UNAVAILABLE",
    message: "This secret is no longer available.",
  },
};
export const deleteUnavailable = {
  error: {
    code: "DELETE_UNAVAILABLE",
    message:
      "This secret could not be deleted. It may already be unavailable, or the delete link may be invalid.",
  },
};
export const validId = (id: string) => /^[A-Za-z0-9_-]{32}$/.test(id);
