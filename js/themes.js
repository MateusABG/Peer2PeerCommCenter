/* Peerly theme system. The selected theme is shared by the login and room pages. */
(() => {
  const themes = {
    peerly: { name: 'Peerly', bg: '#0b0405', panel: '#1a0a0c', text: '#f6e9e9', accent: '#ff2a40', on: '#000000', line: '#3a1218', radius: 6, font: 'inherit' },
    claro: { name: 'Claro', bg: '#ffffff', panel: '#f1f2f5', text: '#1f2430', accent: '#d6162f', on: '#ffffff', line: '#d9dce3', radius: 6, font: 'inherit', light: true },
    suave: { name: 'Suave', bg: '#f6efe6', panel: '#ebe0d2', text: '#4a4036', accent: '#9cb898', on: '#2f3d2c', line: '#e0d3c3', radius: 16, font: 'inherit', light: true },
    game: { name: 'Game', bg: '#0a0f2c', panel: '#12184a', text: '#e8f6ff', accent: '#00e5ff', on: '#050a20', line: '#ff2bd6', radius: 0, font: 'monospace' },
    cyber: { name: 'Cyberpunk', bg: '#0c0c0f', panel: '#17171c', text: '#f5f0d0', accent: '#fcee0a', on: '#000000', line: '#00e0ff', radius: 0, font: 'inherit' },
    hollow: { name: 'Hollow Knight', bg: '#05070d', panel: '#0d1220', text: '#e8e6df', accent: '#9fb4d4', on: '#05070d', line: '#1c2a44', radius: 4, font: 'serif' },
    stardew: { name: 'Stardew Valley', bg: '#fbe8b6', panel: '#e4c487', text: '#5a3a1e', accent: '#4f9a3a', on: '#0e2506', line: '#b9803d', radius: 2, font: 'monospace', light: true },
    gb: { name: 'Game Boy', bg: '#9bbc0f', panel: '#8bac0f', text: '#0f380f', accent: '#306230', on: '#9bbc0f', line: '#0f380f', radius: 0, font: 'monospace', light: true },
    mine: { name: 'Minecraft', bg: '#4a3420', panel: '#7d7d7d', text: '#ffffff', accent: '#5aa02c', on: '#0e2005', line: '#1c1c1c', radius: 0, font: 'monospace' },
    valo: { name: 'Valorant', bg: '#0f1923', panel: '#17222e', text: '#ece8e1', accent: '#ff4655', on: '#0f1923', line: '#2a3a4a', radius: 0, font: 'inherit' },
    under: { name: 'Undertale', bg: '#000000', panel: '#000000', text: '#ffffff', accent: '#ffee00', on: '#000000', line: '#ffffff', radius: 0, font: 'monospace' },
    among: { name: 'Among Us', bg: '#0c1022', panel: '#1b2040', text: '#ffffff', accent: '#c51111', on: '#ffffff', line: '#3b4380', radius: 14, font: 'inherit' },
    ocean: { name: 'Deep Ocean', bg: '#071722', panel: '#0d2635', text: '#e8fbff', accent: '#36cfc9', on: '#062126', line: '#245365', radius: 16, font: 'inherit' },
    sakura: { name: 'Sakura', bg: '#fff1f3', panel: '#fffafb', text: '#55384a', accent: '#d97898', on: '#ffffff', line: '#edcbd5', radius: 20, font: 'inherit', light: true },
    arcade: { name: 'Retro Arcade', bg: '#100a20', panel: '#1a1030', text: '#f9eaff', accent: '#ff4fd8', on: '#100a20', line: '#39f5ff', radius: 5, font: 'monospace' },
    autumn: { name: 'Autumn', bg: '#211912', panel: '#30231a', text: '#fff0dc', accent: '#d98236', on: '#211912', line: '#634a34', radius: 12, font: 'inherit' },
    minimal: { name: 'Minimalist', bg: '#eef1f5', panel: '#ffffff', text: '#293345', accent: '#647fbd', on: '#ffffff', line: '#dce2ea', radius: 10, font: 'inherit', light: true },
    volcanic: { name: 'Volcanic', bg: '#130e0c', panel: '#211714', text: '#fff0e8', accent: '#ff451f', on: '#160d0b', line: '#5a2c20', radius: 9, font: 'inherit' },
    arctic: { name: 'Arctic', bg: '#122334', panel: '#1b3449', text: '#edf9ff', accent: '#8bd8f5', on: '#122334', line: '#41647a', radius: 15, font: 'inherit' },
    terminal: { name: 'Terminal', bg: '#080d09', panel: '#0e1710', text: '#d7ffdc', accent: '#65ff78', on: '#071009', line: '#285333', radius: 3, font: 'monospace' },
    Legendary: { name: 'Legendary Adventure', bg: '#14251b', panel: '#203a2a', text: '#f5edcf', accent: '#d5b45c', on: '#17251b', line: '#718c55', radius: 8, font: 'serif' },
    velocity: { name: 'Sonic Velocity', bg: '#071b46', panel: '#0d2b68', text: '#f4f8ff', accent: '#ffd52a', on: '#061b49', line: '#168bff', radius: 7, font: 'inherit' },
    creature: { name: 'Creature Collector', bg: '#f5f0df', panel: '#e7dfc7', text: '#303b4c', accent: '#e34b48', on: '#ffffff', line: '#4a83bd', radius: 15, font: 'inherit', light: true },
    gothic: { name: 'Gothic Kingdom', bg: '#17151a', panel: '#26212a', text: '#e9e0d0', accent: '#a88a52', on: '#17151a', line: '#59404b', radius: 3, font: 'serif' },
    portal: { name: 'Portal Lab', bg: '#e9edf2', panel: '#ffffff', text: '#28313d', accent: '#ed8135', on: '#ffffff', line: '#3979c5', radius: 11, font: 'inherit', light: true }
  };

  const apply = (key) => {
    const theme = themes[key] ? key : 'escuro';
    const t = themes[theme];
    document.body.dataset.theme = theme;
    const root = document.documentElement;
    root.style.setProperty('--bg', t.bg);
    root.style.setProperty('--panel', t.panel);
    root.style.setProperty('--panel-2', `color-mix(in srgb, ${t.panel} 76%, ${t.bg})`);
    root.style.setProperty('--text', t.text);
    root.style.setProperty('--red', t.accent);
    root.style.setProperty('--accent', t.accent);
    root.style.setProperty('--on-accent', t.on);
    root.style.setProperty('--line', t.line);
    root.style.setProperty('--deep', `color-mix(in srgb, ${t.accent} 28%, ${t.bg})`);
    root.style.setProperty('--muted', `color-mix(in srgb, ${t.text} 62%, ${t.bg})`);
    root.style.setProperty('--radius', `${t.radius}px`);
    root.style.setProperty('--theme-font', t.font);
    root.style.colorScheme = t.light ? 'light' : 'dark';
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = t.bg;
    try { localStorage.setItem('peerly-theme', theme); } catch (_) {}
    document.querySelectorAll('[data-theme-select]').forEach(select => { select.value = theme; });
  };

  const makePicker = () => {
    const select = document.createElement('select');
    select.className = 'theme-select';
    select.setAttribute('aria-label', 'Choose Peerly theme');
    select.dataset.themeSelect = 'true';
    const groups = [
      ['Original themes', ['escuro','claro','suave','game','cyber','hollow','stardew','gb','mine','valo','under','among']],
      ['New themes', ['ocean','sakura','arcade','autumn','minimal','volcanic','arctic','terminal']],
      ['Game-inspired themes', ['Legendary','velocity','creature','gothic','portal']]
    ];
    groups.forEach(([label, keys]) => {
      const group = document.createElement('optgroup'); group.label = label;
      keys.forEach(key => { const option = document.createElement('option'); option.value = key; option.textContent = themes[key].name; group.append(option); });
      select.append(group);
    });
    select.addEventListener('change', () => apply(select.value));
    return select;
  };

  const init = () => {
    let saved = 'escuro';
    try { saved = localStorage.getItem('peerly-theme') || 'escuro'; } catch (_) {}
    apply(saved);
    const roomProfile = document.querySelector('.me');
    if (roomProfile && !document.querySelector('[data-theme-select]')) {
      const wrap = document.createElement('label');
      wrap.className = 'theme-picker';
      wrap.innerHTML = '<span>Appearance</span>';
      wrap.append(makePicker());
      const prefs = roomProfile.querySelector('.prefs');
      if (prefs) prefs.insertAdjacentElement('afterend', wrap); else roomProfile.append(wrap);
    }
    const loginCard = document.querySelector('#login .card');
    if (loginCard && !document.querySelector('[data-theme-select]')) {
      const wrap = document.createElement('label');
      wrap.className = 'login-theme-picker';
      wrap.innerHTML = '<span>Theme</span>';
      wrap.append(makePicker());
      document.body.append(wrap);
    }
    document.querySelectorAll('[data-theme-select]').forEach(select => { select.value = saved; });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
