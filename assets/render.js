/*
 * DevLinks renderer — shared by the public page (index.html) and the admin preview.
 * Builds the page from a links.json object using DOM APIs only (no innerHTML with user data).
 */
(function (global) {
  'use strict';

  // Lucide-style stroke icons (inner SVG markup). Constants only — never user input.
  const ICONS = {
    link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
    globe: '<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>',
    github: '<path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4"/><path d="M9 18c-4.51 2-5-2-7-2"/>',
    linkedin: '<path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6z"/><rect width="4" height="12" x="2" y="9"/><circle cx="4" cy="4" r="2"/>',
    pen: '<path d="M12 20h9"/><path d="M16.376 3.622a1 1 0 0 1 3.002 3.002L7.368 18.635a2 2 0 0 1-.855.506l-2.872.838a.5.5 0 0 1-.62-.62l.838-2.872a2 2 0 0 1 .506-.854z"/>',
    file: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/>',
    mail: '<rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.991 5.727a2 2 0 0 1-2.009 0L2 7"/>',
    youtube: '<path d="M2.5 17a24.12 24.12 0 0 1 0-10 2 2 0 0 1 1.4-1.4 49.56 49.56 0 0 1 16.2 0A2 2 0 0 1 21.5 7a24.12 24.12 0 0 1 0 10 2 2 0 0 1-1.4 1.4 49.55 49.55 0 0 1-16.2 0A2 2 0 0 1 2.5 17"/><path d="m10 15 5-3-5-3z"/>',
    facebook: '<path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z"/>',
    instagram: '<rect width="20" height="20" x="2" y="2" rx="5" ry="5"/><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/><line x1="17.5" x2="17.51" y1="6.5" y2="6.5"/>',
    message: '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>',
    code: '<polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>',
    music: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
    phone: '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>'
  };

  const ICON_LABELS = {
    link: 'Link', globe: 'Website', github: 'GitHub', linkedin: 'LinkedIn', pen: 'Blog',
    file: 'File / Resume', mail: 'Email', youtube: 'YouTube', facebook: 'Facebook',
    instagram: 'Instagram', message: 'Chat / LINE', code: 'Code / Project', music: 'Music', phone: 'Phone'
  };

  const ARROW = '<path d="M7 7h10v10"/><path d="M7 17 17 7"/>';
  const DEFAULT_ACCENT = '#3fb950';

  /** Only allow http(s), mailto and tel links. Anything else becomes "#". */
  function safeUrl(value) {
    const s = String(value || '').trim();
    if (!s) return '#';
    if (/^(mailto:|tel:)/i.test(s)) return s;
    try {
      const u = new URL(s, global.location.href);
      return (u.protocol === 'http:' || u.protocol === 'https:') ? u.href : '#';
    } catch (e) {
      return '#';
    }
  }

  /** Images may also be blob:/data:image (used by the admin preview for fresh uploads). */
  function safeImg(value) {
    const s = String(value || '').trim();
    if (/^blob:/i.test(s) || /^data:image\//i.test(s)) return s;
    const u = safeUrl(s);
    return u === '#' ? '' : u;
  }

  function safeColor(value) {
    return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(String(value || '')) ? value : DEFAULT_ACCENT;
  }

  function h(tag, props) {
    const el = document.createElement(tag);
    const attrs = props || {};
    Object.keys(attrs).forEach(function (k) {
      const v = attrs[k];
      if (v === null || v === undefined || v === false) return;
      if (k === 'class') el.className = v;
      else el.setAttribute(k, v === true ? '' : v);
    });
    for (let i = 2; i < arguments.length; i++) append(el, arguments[i]);
    return el;
  }

  function append(el, child) {
    if (child === null || child === undefined || child === false) return;
    if (Array.isArray(child)) { child.forEach(function (c) { append(el, c); }); return; }
    el.append(child.nodeType ? child : document.createTextNode(String(child)));
  }

  function icon(name, size, extraClass) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', size || 22);
    svg.setAttribute('height', size || 22);
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    if (extraClass) svg.setAttribute('class', extraClass);
    svg.innerHTML = name === '__arrow' ? ARROW : (ICONS[name] || ICONS.link);
    return svg;
  }

  function render(data, root) {
    const d = data || {};
    const p = d.profile || {};
    const handle = (p.handle || 'me').trim() || 'me';
    const stack = Array.isArray(p.stack) ? p.stack.filter(Boolean) : [];
    const links = (Array.isArray(d.links) ? d.links : []).filter(function (l) {
      return l && l.enabled !== false && l.title;
    });

    root.textContent = '';
    root.classList.add('dl');
    root.style.setProperty('--accent', safeColor(p.accent));

    const avatarSrc = safeImg(p.avatar);
    const avatar = avatarSrc
      ? h('img', { class: 'dl-avatar-img', src: avatarSrc, alt: p.name ? p.name + ' profile photo' : 'Profile photo' })
      : h('div', { class: 'dl-avatar-fallback', 'aria-hidden': 'true' }, ((p.name || '?').trim().charAt(0) || '?').toUpperCase() + '_');

    const card = h('section', { class: 'dl-card' },
      h('div', { class: 'dl-titlebar' },
        h('span', { class: 'dl-dot dl-dot-r', 'aria-hidden': 'true' }),
        h('span', { class: 'dl-dot dl-dot-y', 'aria-hidden': 'true' }),
        h('span', { class: 'dl-dot dl-dot-g', 'aria-hidden': 'true' }),
        h('span', { class: 'dl-titlebar-text mono' }, '~/' + handle + ' — zsh')
      ),
      h('div', { class: 'dl-card-body' },
        h('div', { class: 'dl-avatar' }, avatar),
        h('p', { class: 'dl-prompt mono' }, h('span', { class: 'dl-accent' }, handle + '@dev'), ':~$ whoami'),
        h('h1', { class: 'dl-name' }, p.name || '', p.nameLocal ? h('span', { class: 'dl-name-local' }, ' (' + p.nameLocal + ')') : null),
        p.role ? h('p', { class: 'dl-role mono' }, p.role) : null,
        p.bio ? h('p', { class: 'dl-bio' }, p.bio) : null,
        (p.showStatus && p.status) ? h('p', { class: 'dl-status mono' }, h('span', { class: 'dl-status-dot', 'aria-hidden': 'true' }), p.status) : null,
        stack.length ? h('ul', { class: 'dl-stack', 'aria-label': 'Tech stack' }, stack.map(function (s) { return h('li', { class: 'mono' }, s); })) : null
      )
    );

    const nav = h('nav', { class: 'dl-links', 'aria-label': 'Links' },
      links.length ? links.map(function (l) {
        const url = safeUrl(l.url);
        const external = /^https?:/i.test(url) && !url.startsWith(global.location.origin);
        return h('a', {
          class: 'dl-link' + (l.featured ? ' is-featured' : ''),
          href: url,
          target: external ? '_blank' : null,
          rel: external ? 'noopener noreferrer' : null
        },
          icon(l.icon, 22),
          h('span', { class: 'dl-link-text' },
            h('span', { class: 'dl-link-title' }, l.title),
            l.subtitle ? h('span', { class: 'dl-link-sub mono' }, l.subtitle) : null
          ),
          icon('__arrow', 18, 'dl-arrow')
        );
      }) : h('p', { class: 'dl-empty mono' }, '// no links yet')
    );

    const footer = h('footer', { class: 'dl-footer mono' },
      (d.footer || '') + (d.footer ? ' · ' : '') + '© ' + new Date().getFullYear() + ' ' + (p.name || ''));

    root.append(card, nav, footer);
  }

  global.DevLinks = { render: render, ICONS: ICONS, ICON_LABELS: ICON_LABELS, icon: icon, h: h, safeUrl: safeUrl, safeImg: safeImg, safeColor: safeColor };
})(window);
