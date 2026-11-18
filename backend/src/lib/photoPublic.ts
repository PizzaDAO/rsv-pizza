/**
 * Public-safe projection of a photo row. Anonymous / non-editor viewers must never see the
 * uploader's email, the uploader's guest UUID, the reviewer's user id, or the guest's id.
 * A viewer who is the uploader (matching email) keeps their own email.
 */
type PhotoLike = {
  uploaderEmail?: string | null;
  uploadedBy?: string | null;
  reviewedBy?: string | null;
  guest?: { id?: string; name?: string | null } | null;
};

export function sanitizePhotoForPublic<T extends PhotoLike>(
  photo: T,
  viewerEmail?: string | null
): Omit<T, 'guest'> & { guest: { name: string | null } | null } {
  const own =
    !!viewerEmail &&
    !!photo.uploaderEmail &&
    photo.uploaderEmail.toLowerCase() === viewerEmail.toLowerCase();
  const { guest, ...rest } = photo;
  return {
    ...rest,
    uploaderEmail: own ? photo.uploaderEmail ?? null : null,
    uploadedBy: null,
    reviewedBy: null,
    guest: guest ? { name: guest.name ?? null } : null,
  } as Omit<T, 'guest'> & { guest: { name: string | null } | null };
}
