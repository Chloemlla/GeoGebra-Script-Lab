import React, { memo, useEffect, useEffectEvent, useRef, useState } from 'react';
import GeoGebraEngine from '../engine/GeoGebraEngine';
import AppIcon from './AppIcon';
import './GeoGebraContainer.css';

const toCssSize = (value) => (typeof value === 'number' ? `${value}px` : value);

const GeoGebraContainer = ({ onReady, height = 600, canvasMode = null }) => {
  const wrapperRef = useRef(null);
  const containerIdRef = useRef(`geogebra-container-${Math.random().toString(36).slice(2, 8)}`);
  const hasInitializedRef = useRef(false);
  const progressTimerRef = useRef(null);
  const fadeTimerRef = useRef(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [showSkeleton, setShowSkeleton] = useState(true);
  const [loadingProgress, setLoadingProgress] = useState(8);
  const emitReady = useEffectEvent((applet) => {
    onReady?.(applet);
  });

  const resolvedHeight = typeof height === 'number' ? height : Number.parseInt(height, 10) || 600;
  const stageLabel = canvasMode?.stageLabel ?? 'Live Geometry Stage';
  const stageTip = canvasMode?.stageTip ?? '拖拽自由点后可同步回代码';
  const readyHint = canvasMode?.readyHint ?? '可以运行脚本、拖拽自由点或导出图像';

  const cleanupTimers = () => {
    if (progressTimerRef.current) {
      clearInterval(progressTimerRef.current);
      progressTimerRef.current = null;
    }

    if (fadeTimerRef.current) {
      clearTimeout(fadeTimerRef.current);
      fadeTimerRef.current = null;
    }
  };

  useEffect(() => {
    if (!wrapperRef.current) {
      return undefined;
    }

    const updateSize = () => {
      const nextWidth = wrapperRef.current?.clientWidth || 0;
      setContainerWidth(nextWidth);
    };

    updateSize();

    if (typeof ResizeObserver !== 'function') {
      window.addEventListener('resize', updateSize);
      return () => window.removeEventListener('resize', updateSize);
    }

    const observer = new ResizeObserver(updateSize);
    observer.observe(wrapperRef.current);

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!containerWidth || hasInitializedRef.current) {
      return undefined;
    }

    let isCancelled = false;

    const initGeoGebra = async () => {
      setError(null);
      setIsLoading(true);
      setShowSkeleton(true);
      setLoadingProgress(12);

      progressTimerRef.current = setInterval(() => {
        setLoadingProgress((prev) => {
          const next = prev + Math.random() * 18;
          return next > 88 ? 88 : next;
        });
      }, 180);

      try {
        const applet = await GeoGebraEngine.init(containerIdRef.current, {
          appName: canvasMode?.appName,
          width: Math.round(containerWidth),
          height: resolvedHeight,
        });

        if (isCancelled) {
          return;
        }

        cleanupTimers();
        setLoadingProgress(100);
        setIsReady(true);
        setIsLoading(false);
        hasInitializedRef.current = true;
        emitReady(applet);

        fadeTimerRef.current = setTimeout(() => {
          setShowSkeleton(false);
        }, 240);
      } catch (err) {
        if (isCancelled) {
          return;
        }

        cleanupTimers();
        console.error('GeoGebra 初始化失败:', err);
        setError(err.message);
        setIsLoading(false);
        setShowSkeleton(false);
      }
    };

    initGeoGebra();

    return () => {
      isCancelled = true;
      cleanupTimers();
    };
  }, [containerWidth]);

  useEffect(() => () => {
    cleanupTimers();
    GeoGebraEngine.destroy();
  }, []);

  useEffect(() => {
    if (!isReady || !containerWidth) {
      return;
    }

    GeoGebraEngine.resize(containerWidth, resolvedHeight);
  }, [containerWidth, isReady, resolvedHeight]);

  return (
    <div
      ref={wrapperRef}
      className="geogebra-shell"
      style={{ height: toCssSize(height) }}
    >
      <div className="geogebra-topbar" aria-hidden="true">
        <span className="geogebra-topbar-label">{stageLabel}</span>
        <span className="geogebra-topbar-tip">{stageTip}</span>
      </div>

      <div id={containerIdRef.current} className="geogebra-stage" />

      {showSkeleton && !error && (
        <div className={`geogebra-skeleton ${!isLoading ? 'is-leaving' : ''}`}>
          <div className="skeleton-orbit orbit-one"></div>
          <div className="skeleton-orbit orbit-two"></div>

          <div className="skeleton-card">
            <div className="skeleton-line short"></div>
            <div className="skeleton-line medium"></div>
            <div className="skeleton-grid">
              <div className="skeleton-block"></div>
              <div className="skeleton-block"></div>
              <div className="skeleton-block"></div>
            </div>
          </div>

          <div className="loading-progress">
            <div className="progress-bar" style={{ width: `${loadingProgress}%` }}></div>
          </div>

          <div className="loading-text">
            <p>正在加载 GeoGebra 画布</p>
            <p className="loading-hint">
              {loadingProgress < 45
                ? '正在连接渲染引擎...'
                : loadingProgress < 90
                ? '正在准备工作台坐标系...'
                : '即将完成初始化...'}
            </p>
          </div>
        </div>
      )}

      {error && (
        <div className="geogebra-error">
          <div className="error-icon">
            <AppIcon className="error-icon-image" decorative />
          </div>
          <p className="error-title">GeoGebra 加载失败</p>
          <p className="error-message">{error}</p>
          <p className="error-hint">
            可能原因包括网络不稳定、CDN 不可用或浏览器扩展拦截。请刷新页面重试。
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="error-retry-btn"
          >
            刷新并重试
          </button>
        </div>
      )}

      {isReady && !showSkeleton && !error && (
        <div className="geogebra-ready-hint">
          <span>GeoGebra 已就绪</span>
          <small>{readyHint}</small>
        </div>
      )}
    </div>
  );
};

export default memo(GeoGebraContainer);
