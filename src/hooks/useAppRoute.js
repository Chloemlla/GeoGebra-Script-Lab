import { useCallback, useEffect, useState } from 'react';
import { buildAppPageHref, resolveAppPage } from '../utils/appRoutes';

function readCurrentPage() {
  if (typeof window === 'undefined') {
    return resolveAppPage('/');
  }

  return resolveAppPage(window.location.pathname, window.location.search);
}

export default function useAppRoute() {
  const [currentPage, setCurrentPage] = useState(readCurrentPage);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }

    const handleLocationChange = () => {
      setCurrentPage(readCurrentPage());
    };

    window.addEventListener('popstate', handleLocationChange);
    window.addEventListener('hashchange', handleLocationChange);

    return () => {
      window.removeEventListener('popstate', handleLocationChange);
      window.removeEventListener('hashchange', handleLocationChange);
    };
  }, []);

  const navigateToPage = useCallback((pageId) => {
    if (typeof window === 'undefined') {
      return;
    }

    const nextPath = buildAppPageHref(pageId);
    const nextUrl = new URL(window.location.href);
    nextUrl.pathname = nextPath;

    if (nextPath !== '/studio') {
      nextUrl.searchParams.delete('share');
    }

    const nextHref = `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`;
    const currentHref = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (nextHref === currentHref) {
      return;
    }

    window.history.pushState({}, '', nextHref);
    setCurrentPage(resolveAppPage(nextUrl.pathname, nextUrl.search));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  return {
    currentPage,
    navigateToPage,
  };
}
