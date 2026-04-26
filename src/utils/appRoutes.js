export const APP_PAGE_IDS = Object.freeze({
  overview: 'overview',
  studio: 'studio',
  backend: 'backend',
});

export const APP_PAGES = Object.freeze([
  {
    id: APP_PAGE_IDS.overview,
    label: '概览',
    path: '/',
  },
  {
    id: APP_PAGE_IDS.studio,
    label: '工作台',
    path: '/studio',
  },
  {
    id: APP_PAGE_IDS.backend,
    label: '后端',
    path: '/backend',
  },
]);

const APP_PAGE_MAP = new Map(APP_PAGES.map((page) => [page.id, page]));

function normalizePathname(pathname = '/') {
  const trimmed = `${pathname}`.trim();
  if (!trimmed || trimmed === '/') {
    return '/';
  }

  return trimmed.endsWith('/') ? trimmed.slice(0, -1) : trimmed;
}

export function getAppPageById(pageId) {
  return APP_PAGE_MAP.get(pageId) ?? APP_PAGE_MAP.get(APP_PAGE_IDS.overview);
}

export function buildAppPageHref(pageId) {
  return getAppPageById(pageId).path;
}

export function resolveAppPage(pathname, search = '') {
  const searchParams = new URLSearchParams(search);
  if (searchParams.has('share')) {
    return getAppPageById(APP_PAGE_IDS.studio);
  }

  const normalizedPathname = normalizePathname(pathname);
  return (
    APP_PAGES.find((page) => normalizePathname(page.path) === normalizedPathname)
    ?? getAppPageById(APP_PAGE_IDS.overview)
  );
}
