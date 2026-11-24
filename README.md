# >_ devlinks

A developer-themed "link in bio" page (like Linktree) that runs entirely on **GitHub Pages**, with a built-in **admin page** to manage links from the browser — no backend, no database, no build step.

| Page | URL | What it does |
| --- | --- | --- |
| **Show** | `/` (`index.html`) | Public page. Reads `links.json` and renders the profile + links. |
| **Admin** | `/admin.html` | Edit profile, add / remove / reorder links, upload a photo, live preview, then **Save to GitHub**. |

## How it works

```
admin.html ──(GitHub REST API + your token)──▶ commits links.json
                                                     │
                                       GitHub Actions │ deploy.yml
                                                     ▼
index.html ◀── fetch links.json ◀── GitHub Pages (redeploys in ~1 min)
```

- All content lives in **`links.json`** — the repo *is* the database, and every edit is a commit (free history + rollback).
- The admin page calls `api.github.com` directly from your browser with a fine-grained personal access token. The token is stored only in your browser (session by default, or "remember on this device").
- Without a token the admin page still works as an editor: use **Download JSON** and commit the file yourself.

## Project structure

```
.
├── index.html              # Show page
├── admin.html              # Admin page
├── links.json              # All content (profile, links, footer)
├── assets/
│   ├── render.js           # Shared renderer (show page + admin preview)
│   ├── style.css           # Show page styles
│   ├── admin.js            # Admin logic + GitHub API
│   ├── admin.css           # Admin styles
│   └── uploads/            # Photos uploaded from the admin page
└── .github/workflows/
    └── deploy.yml          # Validate JSON + deploy to Pages on every push to main
```

## Setup

1. **Create the repo** — push this folder to a new GitHub repository (e.g. `devlinks`).
2. **Enable Pages** — *Settings → Pages → Build and deployment → Source: **GitHub Actions***.
3. Push to `main` (or run the workflow manually). Your page is live at `https://<user>.github.io/<repo>/`.
4. **Create a token for the admin page** — *GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token*:
   - Repository access: **Only select repositories** → this repo
   - Permissions → Repository → **Contents: Read and write**
   - Set an expiry date
5. Open `https://<user>.github.io/<repo>/admin.html`, paste the token, click **Connect & load**. Owner and repo are pre-filled when you're on `github.io`.

## Run locally

`fetch()` needs a web server (opening the file directly won't load `links.json`):

```bash
npx serve .
# or
python3 -m http.server 8080
```

Then open `http://localhost:8080/` and `http://localhost:8080/admin.html`.

## `links.json` format

```json
{
  "profile": {
    "name": "Tao",
    "nameLocal": "เต่า",
    "handle": "tao",
    "role": "Full Stack Developer",
    "bio": "…",
    "avatar": "assets/uploads/avatar.jpg",
    "status": "Open to opportunities",
    "showStatus": true,
    "stack": ["Angular", "NestJS"],
    "accent": "#3fb950"
  },
  "links": [
    {
      "id": "github",
      "title": "GitHub",
      "subtitle": "github.com/you",
      "url": "https://github.com/you",
      "icon": "github",
      "featured": false,
      "enabled": true
    }
  ],
  "footer": "// thanks for stopping by"
}
```

Icons: `link`, `globe`, `github`, `linkedin`, `pen`, `file`, `mail`, `youtube`, `facebook`, `instagram`, `message`, `code`, `music`, `phone`.
Only `http(s)://`, `mailto:` and `tel:` URLs are rendered; anything else becomes `#`.

## Security notes

- `admin.html` is publicly reachable but can't change anything without a token that has write access to the repo.
- Use a **fine-grained** token scoped to this one repo with only *Contents* permission, and give it an expiry.
- Anyone with access to your browser profile can read a remembered token — use "Disconnect" on shared machines.
- All user content is rendered with `textContent` / DOM APIs (no `innerHTML`), so link titles can't inject HTML.

## Social previews

Link previews (LINE, Facebook, X) come from the `<meta property="og:…">` tags in `index.html`. Crawlers don't run JavaScript, so edit those by hand.

## Roadmap ideas

- [ ] Show latest GitHub repos / stars via the GitHub API
- [ ] Interactive terminal mode (`help`, `projects`, `contact`)
- [ ] Themes (GitHub Dark, Dracula, Nord)
- [ ] QR code for the page
- [ ] v2: Angular + NestJS + PostgreSQL with login and click analytics

## License

MIT
