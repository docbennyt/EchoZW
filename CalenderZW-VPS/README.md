# CalenderZW VPS package

This archive contains the completed CalenderZW public landing page.

## Files

- `public/index.html` — self-contained production landing page. All CSS, icons, motion and JavaScript are inline; no image or font files are required.
- `source/worker.js` — the original Cloudflare/Sites worker source used to generate the page.
- `nginx/landing-location.conf` — a safe Nginx location snippet for serving only the public root without replacing existing application routes.
- `SHA256SUMS` — file integrity hashes.

## Upload

1. Upload the `public` directory to `/var/www/calenderzw/public` on the VPS.
2. Set ownership for the web-server user used by your VPS.
3. Add the contents of `nginx/landing-location.conf` inside the existing `server {}` block for `calender.aido.co.zw`.
4. Test the Nginx configuration, then reload Nginx.

Example commands after uploading:

```bash
sudo mkdir -p /var/www/calenderzw/public
sudo cp public/index.html /var/www/calenderzw/public/index.html
sudo chown -R www-data:www-data /var/www/calenderzw
sudo nginx -t
sudo systemctl reload nginx
```

## Important route note

Do not replace the existing application-wide Nginx configuration with a generic single-page-app fallback. CalenderZW already has application routes such as `/admin`, `/t/...`, `/calendar/...`, `/privacy`, `/terms`, `/data-deletion` and `/support`. Merge only the exact-root location supplied here so those routes continue to use their existing handlers.

The page currently links timetable, class-representative and legal actions to the canonical `https://calender.aido.co.zw` URLs. Confirm those destinations against the existing production router before switching the public root.

## Requirements

The static landing page has no Node.js, npm, database or build-time dependency. JavaScript enhances the interactive steps and scroll reveals, while the core content and links remain readable without it.
