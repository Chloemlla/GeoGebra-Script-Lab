export const APP_PAGE_IDS = Object.freeze({
  auth: 'auth',
  overview: 'overview',
  studio: 'studio',
  backend: 'backend',
});

export const APP_PAGES = Object.freeze([
  {
    id: APP_PAGE_IDS.auth,
    label: '账号',
    path: '/auth',
    description: '登录、注册与当前会话管理',
  },
  {
    id: APP_PAGE_IDS.overview,
    label: '概览',
    path: '/',
    description: '查看产品概览、入门示例与使用入口',
  },
  {
    id: APP_PAGE_IDS.studio,
    label: '工作台',
    path: '/studio',
    description: '编写脚本、运行画布并同步拖拽结果',
  },
  {
    id: APP_PAGE_IDS.backend,
    label: '后端',
    path: '/backend',
    description: '调用后端能力、AI 生成与管理控制台',
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
