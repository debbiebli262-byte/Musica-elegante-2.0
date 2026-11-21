# Música Elegante — Data safety and catalog maintenance

## What is protected
The app is restricted in its interface to two verified Firebase Authentication identities. Source-controlled Firestore and Storage rules grant read/write only to those two verified email identities. **A rule file committed to GitHub is not proof that the rules are deployed**. Check the effective rules in Firebase Console and deploy them independently.

Do not distribute the export file: it may contain personal collection data and imported document metadata.

## Make a metadata backup before cleanup
1. Sign in to the live website with one of the authorized accounts.
2. On the home page, choose **Descargar copia JSON** under **Seguridad e integridad del catálogo**.
3. Verify the downloaded JSON includes `format: "musica-elegante-backup"`, `version: 1`, an `exportedAt` date, plus `albums`, `artists`, `collection` and `import_jobs` arrays.
4. Store a copy in a secure offline location.

This is a *manual, read-only export*, not an automatic disaster-recovery system. It does **not** download Firebase Storage images, Word uploads, or other binary objects and cannot currently be imported automatically. Do not rely on it as the only backup.

For recoverable offsite backup, configure **Cloud Firestore managed backups** in Google Cloud/Firebase and **Cloud Storage bucket versioning or lifecycle-managed copies** for the Storage bucket. Verify retention, restore permissions, and actual restoration in a separate environment. Confirm billing, cost and availability in the project's own consoles.

## Check catalog quality
Choose **Revisar catálogo** to get a non-destructive report for missing artist references, missing artist names/titles, repeat record-label tokens, incomplete classical work hierarchies, and possible duplicate *editions*. These are warnings, not guaranteed errors. A release with the same title but a different catalog number, year, label, or format is **not** automatically merged or removed.

Never use automated delete-by-title as a cleanup strategy. Inspect and manually resolve possible duplicates only after an external backup has been verified.

## Before publishing changes
- Run the TypeScript check and Vite build.
- Check Google sign-in with both authorized accounts and that a third account cannot access the library.
- Verify effective Firestore and Storage rules in the project's consoles.
- Test collection edits, imports, classical discs/works/movements, and the mobile album modal.
- Confirm Vercel production points to GitHub repo `debbiebli262-byte/Musica-elegante-2.0`, `main`.
