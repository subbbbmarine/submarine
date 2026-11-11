# submarine.live

The coming-soon page and the docs, served as plain files from `public/` on Cloudflare Pages.

The docs at submarine.live/docs are the terminal's own pages (`web/src/app/docs`), built as plain files by
`build-docs.mjs` with the layout in `docs-site/`: no wallet or menu, a line saying the contracts are not on Zero yet, and
links into the terminal shown as plain names. The build lands in `public/` (`docs/`, `docs.html`, `_next/`), which git
ignores. Rebuild them before every deploy that should carry docs changes, from the repository's folder:

    node landing/build-docs.mjs

Then deploy from this folder:

    npx wrangler pages deploy public --project-name submarine-live --branch main

- Hero photo: Unsplash, free licence (photo 1688946154620-dbfd102a5981).
- X links stay hidden until `X_URL` at the bottom of `public/index.html` is set.
- Footer links marked "soon" are grey and not clickable; turn one into a link when that page exists.
