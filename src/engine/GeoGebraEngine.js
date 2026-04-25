/**
 * GeoGebra 引擎初始化模块
 * 负责：
 * 1. 异步加载和初始化 GeoGebra Applet
 * 2. 配置引擎参数（隐藏工具栏、设置语言等）
 * 3. 提供初始化完成的生命周期钩子
 */

class GeoGebraEngine {
  constructor() {
    this.applet = null;
    this.appletInstance = null;
    this.isReady = false;
    this.isInitializing = false;
    this.readyPromise = null;
    this.updateListeners = new Set();
    this.manualChangeListeners = new Set();
    this.maxInitAttempts = 50;
    this.initAttempts = 0;
    this.containerId = null;
    this.currentAppName = null;
    this.currentAppletName = null;
    this._initToken = 0;
    this._timeoutHandle = null;
    this._restoreGlobalInit = null;
    this.boundUpdateHandler = this.handleUpdate.bind(this);
    this.boundClientHandler = this.handleClientEvent.bind(this);
  }

  static ASSIGNMENT_TARGET_PATTERN = /^(?<name>[_\p{L}][_\p{L}\p{N}'’]*)(?:\s*\((?<params>[^()]*)\))?$/u;
  static DEFAULT_APP_NAME = 'geometry';

  resolveAppName(options = {}) {
    if (typeof options.appName === 'string' && options.appName.trim().length > 0) {
      return options.appName.trim();
    }

    return GeoGebraEngine.DEFAULT_APP_NAME;
  }

  /**
   * 初始化 GeoGebra Applet
   * 解决异步加载和生命周期地狱问题
   * @param {string} containerId - 容器元素的 ID
   * @param {object} options - 配置选项
   */
  async init(containerId, options = {}) {
    const requestedAppName = this.resolveAppName(options);

    if (this.isInitializing) {
      if (this.currentAppName === requestedAppName) {
        console.warn('GeoGebra 正在初始化中，请勿重复调用');
        return this.readyPromise;
      }

      this.destroy();
    }

    if (this.isReady) {
      if (this.currentAppName === requestedAppName) {
        if (containerId && this.containerId !== containerId && typeof this.appletInstance?.inject === 'function') {
          this.appletInstance.inject(containerId);
          this.containerId = containerId;
        }

        if (options.width || options.height) {
          this.resize(options.width, options.height);
        }

        return Promise.resolve(this.applet);
      }

      this.destroy();
    }

    const initToken = ++this._initToken;
    this.isInitializing = true;
    this.initAttempts = 0;
    this.currentAppName = requestedAppName;

    this.readyPromise = new Promise((resolve, reject) => {
      const rejectWithCleanup = (error) => {
        if (initToken !== this._initToken) {
          return;
        }

        if (this._timeoutHandle) {
          clearTimeout(this._timeoutHandle);
          this._timeoutHandle = null;
        }

        if (this._restoreGlobalInit) {
          this._restoreGlobalInit();
          this._restoreGlobalInit = null;
        }

        this.isInitializing = false;
        this.isReady = false;
        this.readyPromise = null;
        this.currentAppName = null;
        reject(error);
      };

      const checkGeoGebra = setInterval(() => {
        if (initToken !== this._initToken) {
          clearInterval(checkGeoGebra);
          return;
        }

        this.initAttempts++;

        if (!window.GGBApplet) {
          if (this.initAttempts > this.maxInitAttempts) {
            clearInterval(checkGeoGebra);
            rejectWithCleanup(
              new Error('GeoGebra 库加载超时（>5秒）。请检查网络连接或 CDN 可用性。')
            );
          }
          return;
        }

        clearInterval(checkGeoGebra);

        try {
          const {
            appletOnLoad: userAppletOnLoad,
            ...restOptions
          } = options;

          let hasResolvedInit = false;

          const finalizeInit = (api, appletName = null) => {
            if (hasResolvedInit || initToken !== this._initToken) {
              return;
            }

            const resolvedApi = api
              || (appletName ? window[appletName] : null)
              || (typeof ggbApplet.getAppletObject === 'function' ? ggbApplet.getAppletObject() : null)
              || ggbApplet;

            hasResolvedInit = true;

            if (this._timeoutHandle) {
              clearTimeout(this._timeoutHandle);
              this._timeoutHandle = null;
            }

            if (this._restoreGlobalInit) {
              this._restoreGlobalInit();
              this._restoreGlobalInit = null;
            }

            this.appletInstance = ggbApplet;
            this.applet = resolvedApi;
            this.containerId = containerId;
            this.currentAppletName = appletName;
            this.isReady = true;
            this.isInitializing = false;

            if (typeof this.applet?.registerUpdateListener === 'function') {
              this.applet.registerUpdateListener(this.boundUpdateHandler);
            }

            if (typeof this.applet?.registerClientListener === 'function') {
              this.applet.registerClientListener(this.boundClientHandler);
            }

            console.log(`✓ GeoGebra 初始化完成 (${requestedAppName})`);
            resolve(this.applet);
          };

          const defaultOptions = {
            appName: requestedAppName,
            width: 800,
            height: 600,
            showToolBar: false,
            showMenuBar: false,
            showAlgebraInput: false,
            showResetIcon: false,
            showZoomButtons: false,
            enableLabelDrags: true,
            enableRightClick: true,
            enableCAS: false,
            enableFileMenu: false,
            showFullscreenButton: false,
            language: 'en',
            useBrowserForJS: true,
            prerelease: false,
            allowStyleBar: false,
            allowUpscaleContent: false,
            preventFocus: false,
            scaleContainerClass: 'geogebra-scale-container',
            appletOnLoad: (api) => {
              if (typeof userAppletOnLoad === 'function') {
                userAppletOnLoad(api);
              }
              finalizeInit(api);
            },
            ...restOptions,
          };

          const ggbApplet = new window.GGBApplet(defaultOptions, true);
          const originalGgbOnInit = window.ggbOnInit;
          const wrappedGgbOnInit = (appletName, api) => {
            try {
              if (typeof originalGgbOnInit === 'function') {
                originalGgbOnInit(appletName, api);
              }

              finalizeInit(api, appletName);
            } catch (err) {
              console.error('GeoGebra 初始化回调中发生错误:', err);
              rejectWithCleanup(err);
            }
          };

          this._restoreGlobalInit = () => {
            if (window.ggbOnInit === wrappedGgbOnInit) {
              window.ggbOnInit = originalGgbOnInit;
            }
          };

          window.ggbOnInit = wrappedGgbOnInit;

          ggbApplet.inject(containerId);
        } catch (err) {
          console.error('GeoGebra 初始化过程中发生错误:', err);
          rejectWithCleanup(err);
        }
      }, 100);

      this._timeoutHandle = setTimeout(() => {
        clearInterval(checkGeoGebra);
        rejectWithCleanup(
          new Error('GeoGebra 加载超时（>5秒）。可能的原因：网络慢、CDN 不可用、浏览器扩展干扰。')
        );
      }, 5000);
    });

    return this.readyPromise;
  }

  destroy() {
    this._initToken++;

    if (this._timeoutHandle) {
      clearTimeout(this._timeoutHandle);
      this._timeoutHandle = null;
    }

    if (this._restoreGlobalInit) {
      this._restoreGlobalInit();
      this._restoreGlobalInit = null;
    }

    if (this.applet) {
      try {
        if (typeof this.applet.unregisterUpdateListener === 'function') {
          this.applet.unregisterUpdateListener(this.boundUpdateHandler);
        }
      } catch (_error) {
        // 忽略不支持的注销接口
      }

      try {
        if (typeof this.applet.unregisterClientListener === 'function') {
          this.applet.unregisterClientListener(this.boundClientHandler);
        }
      } catch (_error) {
        // 忽略不支持的注销接口
      }
    }

    if (this.containerId && typeof document !== 'undefined') {
      const container = document.getElementById(this.containerId);
      if (container) {
        container.replaceChildren();
      }
    }

    if (this.currentAppletName && typeof window !== 'undefined' && this.currentAppletName in window) {
      try {
        delete window[this.currentAppletName];
      } catch (_error) {
        window[this.currentAppletName] = undefined;
      }
    }

    this.applet = null;
    this.appletInstance = null;
    this.isReady = false;
    this.isInitializing = false;
    this.readyPromise = null;
    this.containerId = null;
    this.currentAppName = null;
    this.currentAppletName = null;

    return true;
  }

  /**
   * 等待 GeoGebra 引擎就绪
   */
  async ready() {
    if (this.isReady) {
      return Promise.resolve(this.applet);
    }

    return this.readyPromise;
  }

  /**
   * 获取 Applet 实例
   */
  getApplet() {
    return this.applet;
  }

  /**
   * 检查引擎是否就绪
   */
  isAppletReady() {
    return this.isReady;
  }

  /**
   * 调整 Applet 尺寸
   * @param {number} width - 宽度
   * @param {number} height - 高度
   */
  resize(width, height) {
    if (!this.isReady || !this.appletInstance || typeof this.appletInstance.setSize !== 'function') {
      return false;
    }

    try {
      this.appletInstance.setSize(Math.round(width), Math.round(height));
      return true;
    } catch (error) {
      console.warn('调整 GeoGebra 画板尺寸失败', error);
      return false;
    }
  }

  /**
   * 执行单行 GeoGebra 指令
   * 代码执行前必须确保引擎已就绪（生命周期安全）
   * @param {string} command - GeoGebra 指令
   * @returns {boolean} - 执行是否成功
   * @throws {Error} - 如果引擎未就绪
   */
  executeCommand(command) {
    if (!this.isReady) {
      throw new Error(
        '生命周期错误: GeoGebra Applet 尚未就绪。请在调用 executeCommand 前等待 ready() 完成。'
      );
    }

    if (!this.applet) {
      throw new Error('GeoGebra Applet 实例不存在');
    }

    if (typeof command !== 'string' || command.trim().length === 0) {
      console.warn('空指令被跳过');
      return true;
    }

    const targetLabel = this.extractAssignedObjectName(command);
    try {
      const beforeNames = new Set(this.getAllObjectNames());
      const beforeHasTarget = targetLabel ? beforeNames.has(targetLabel) : false;
      const result = this.applet.evalCommand(command);
      const afterNames = new Set(this.getAllObjectNames());
      const afterHasTarget = targetLabel ? afterNames.has(targetLabel) : false;

      if (
        result !== false
        || (!beforeHasTarget && afterHasTarget)
        || afterNames.size > beforeNames.size
      ) {
        return true;
      }

      if (typeof this.applet.evalCommandGetLabels === 'function') {
        const createdLabels = this.applet.evalCommandGetLabels(command);
        if (typeof createdLabels === 'string' && createdLabels.trim().length > 0) {
          return true;
        }

        const retryNames = new Set(this.getAllObjectNames());
        const retryHasTarget = targetLabel ? retryNames.has(targetLabel) : false;
        if (
          (!beforeHasTarget && retryHasTarget)
          || retryNames.size > beforeNames.size
        ) {
          return true;
        }
      }
    } catch (error) {
      console.error(`执行指令时发生异常: ${command}`, error);
    }

    console.warn(`指令执行返回 false: ${command}`);
    return false;
  }

  /**
   * 获取对象的值
   * @param {string} objectName - 对象名称
   * @returns {string|number|null} - 对象的值
   */
  getValue(objectName) {
    if (!this.isReady) return null;
    try {
      return this.applet.getValueString(objectName);
    } catch (error) {
      console.warn(`无法获取对象值: ${objectName}`, error);
      return null;
    }
  }

  /**
   * 重置画板到干净状态
   * 解决“脏画布”问题：防止旧变量和图形干扰新执行的代码
   */
  reset() {
    if (!this.isReady || !this.applet) {
      console.warn('无法重置：Applet 未就绪');
      return false;
    }

    try {
      this.applet.reset();
      console.log('✓ 画板已重置为干净状态');
      return true;
    } catch (error) {
      console.error('重置画板时出错:', error);
      return false;
    }
  }

  /**
   * 清空所有对象（更强制的清空方式）
   */
  clear() {
    if (!this.isReady || !this.applet) {
      console.warn('无法清空：Applet 未就绪');
      return false;
    }

    try {
      const allObjects = this.getAllObjectNames();
      if (allObjects && allObjects.length > 0) {
        allObjects.forEach((objName) => {
          try {
            this.applet.deleteObject(objName);
          } catch (_error) {
            // 某些内置对象不能删除，忽略错误
          }
        });
      }
      console.log('✓ 所有对象已清空');
      return true;
    } catch (error) {
      console.error('清空对象时出错:', error);
      return false;
    }
  }

  /**
   * 导出图片
   * @param {string} _format - 图片格式
   * @returns {string|null}
   */
  exportImage(_format = 'png') {
    if (!this.isReady) return null;
    try {
      if (typeof this.applet.getPNGBase64 === 'function') {
        return `data:image/png;base64,${this.applet.getPNGBase64(1, true)}`;
      }

      if (typeof this.applet.getScreenshotBase64 === 'function') {
        return new Promise((resolve) => {
          this.applet.getScreenshotBase64((base64) => {
            resolve(
              typeof base64 === 'string' && base64.length > 0
                ? `data:image/png;base64,${base64}`
                : null
            );
          });
        });
      }

      throw new TypeError('GeoGebra API 不支持 PNG 导出');
    } catch (error) {
      console.error('导出图片失败', error);
      return null;
    }
  }

  /**
   * 批量更新对象样式
   * @param {object} options
   * @param {string[]} options.objectNames - 目标对象
   * @param {string} [options.color] - 十六进制颜色
   * @param {number} [options.lineThickness] - 线宽
   * @param {number} [options.pointSize] - 点大小
   * @param {boolean} [options.labelVisible] - 是否显示标签
   * @returns {{updatedCount: number, attemptedCount: number}}
   */
  applyObjectStyles(options = {}) {
    if (!this.isReady || !this.applet) {
      return {
        updatedCount: 0,
        attemptedCount: 0,
      };
    }

    const {
      objectNames = this.getAllObjectNames(),
      color,
      lineThickness,
      pointSize,
      labelVisible,
    } = options;

    const targets = Array.isArray(objectNames) ? objectNames.filter(Boolean) : [];
    let updatedCount = 0;

    targets.forEach((objectName) => {
      let didUpdate = false;

      try {
        if (typeof color === 'string' && typeof this.applet.setColor === 'function') {
          const rgb = this.hexToRgb(color);
          if (rgb) {
            this.applet.setColor(objectName, rgb.r, rgb.g, rgb.b);
            didUpdate = true;
          }
        }

        if (
          typeof lineThickness === 'number'
          && Number.isFinite(lineThickness)
          && typeof this.applet.setLineThickness === 'function'
        ) {
          this.applet.setLineThickness(objectName, Math.max(1, Math.round(lineThickness)));
          didUpdate = true;
        }

        if (
          typeof pointSize === 'number'
          && Number.isFinite(pointSize)
          && typeof this.applet.setPointSize === 'function'
        ) {
          this.applet.setPointSize(objectName, Math.max(1, Math.round(pointSize)));
          didUpdate = true;
        }

        if (typeof labelVisible === 'boolean' && typeof this.applet.setLabelVisible === 'function') {
          this.applet.setLabelVisible(objectName, labelVisible);
          didUpdate = true;
        }

        if (didUpdate) {
          updatedCount++;
        }
      } catch (error) {
        console.warn(`更新对象样式失败: ${objectName}`, error);
      }
    });

    return {
      updatedCount,
      attemptedCount: targets.length,
    };
  }

  /**
   * 控制网格显示
   * @param {boolean} isVisible
   * @returns {boolean}
   */
  setGridVisible(isVisible) {
    if (!this.isReady || !this.applet) {
      return false;
    }

    try {
      if (typeof this.applet.showGrid === 'function') {
        this.applet.showGrid(Boolean(isVisible));
        return true;
      }

      if (typeof this.applet.setGridVisible === 'function') {
        this.applet.setGridVisible(Boolean(isVisible));
        return true;
      }
    } catch (error) {
      console.warn('更新网格状态失败', error);
    }

    return false;
  }

  /**
   * 控制坐标轴显示
   * @param {boolean} isVisible
   * @returns {boolean}
   */
  setAxesVisible(isVisible) {
    if (!this.isReady || !this.applet) {
      return false;
    }

    try {
      if (typeof this.applet.setAxesVisible === 'function') {
        this.applet.setAxesVisible(Boolean(isVisible), Boolean(isVisible));
        return true;
      }

      if (typeof this.applet.showAxes === 'function') {
        this.applet.showAxes(Boolean(isVisible), Boolean(isVisible));
        return true;
      }
    } catch (error) {
      console.warn('更新坐标轴状态失败', error);
    }

    return false;
  }

  /**
   * 注册对象变化监听器
   * @param {function} listener - 监听器回调函数
   * @returns {function}
   */
  onUpdate(listener) {
    if (typeof listener !== 'function') {
      return () => {};
    }

    this.updateListeners.add(listener);
    return () => this.updateListeners.delete(listener);
  }

  /**
   * 注册用户手动拖拽监听器
   * @param {function} listener - 监听器回调函数
   * @returns {function}
   */
  onManualChange(listener) {
    if (typeof listener !== 'function') {
      return () => {};
    }

    this.manualChangeListeners.add(listener);
    return () => this.manualChangeListeners.delete(listener);
  }

  /**
   * 处理对象更新事件
   */
  handleUpdate(objectName) {
    this.updateListeners.forEach((listener) => {
      try {
        listener(this.applet, objectName);
      } catch (error) {
        console.error('监听器执行出错', error);
      }
    });
  }

  /**
   * 处理客户端事件
   * 只关心用户拖拽导致的 movedGeos 事件，避免把普通渲染更新误判为脏状态
   */
  handleClientEvent(event) {
    if (!event || event.type !== 'movedGeos') {
      return;
    }

    const labels = this.normalizeObjectNames(event.targets ?? event.argument ?? event.target);
    if (labels.length === 0) {
      return;
    }

    this.manualChangeListeners.forEach((listener) => {
      try {
        listener({
          type: event.type,
          labels,
          rawEvent: event,
        });
      } catch (error) {
        console.error('手动变更监听器执行出错', error);
      }
    });
  }

  /**
   * 获取所有对象名称
   * @param {string} type - 可选对象类型
   * @returns {string[]}
   */
  getAllObjectNames(type) {
    if (!this.isReady) return [];
    try {
      return type ? this.applet.getAllObjectNames(type) : this.applet.getAllObjectNames();
    } catch (error) {
      console.warn('获取对象名称失败', error);
      return [];
    }
  }

  /**
   * 获取可被拖拽的自由点状态，供“同步回代码”使用
   * @param {string[]} objectNames - 限定对象名称
   * @returns {Array<{name: string, x: number, y: number, command: string}>}
   */
  exportFreePointsAsCode(objectNames = null) {
    if (!this.isReady || !this.applet) {
      return [];
    }

    const candidateNames = Array.isArray(objectNames) && objectNames.length > 0
      ? objectNames
      : this.getAllObjectNames('point');

    return candidateNames
      .map((name) => this.getFreePointState(name))
      .filter(Boolean);
  }

  /**
   * 批量锁定或解锁自由点拖拽
   * @param {boolean} isLocked - 是否锁定
   * @returns {boolean}
   */
  setInteractivePointsLocked(isLocked) {
    if (!this.isReady || !this.applet || typeof this.applet.setFixed !== 'function') {
      return false;
    }

    try {
      this.getAllObjectNames('point').forEach((objectName) => {
        if (this.isDraggableFreePoint(objectName)) {
          this.applet.setFixed(objectName, isLocked, true);
        }
      });
      return true;
    } catch (error) {
      console.warn('更新自由点锁定状态失败', error);
      return false;
    }
  }

  /**
   * 获取自由点状态
   * @param {string} objectName - 对象名称
   * @returns {{name: string, x: number, y: number, command: string}|null}
   */
  getFreePointState(objectName) {
    if (!this.isDraggableFreePoint(objectName)) {
      return null;
    }

    try {
      const x = this.applet.getXcoord(objectName);
      const y = this.applet.getYcoord(objectName);

      return {
        name: objectName,
        x,
        y,
        command: `${objectName} = (${this.formatNumber(x)}, ${this.formatNumber(y)})`,
      };
    } catch (error) {
      console.warn(`读取自由点状态失败: ${objectName}`, error);
      return null;
    }
  }

  /**
   * 判断对象是否是可拖拽的自由点
   * @param {string} objectName - 对象名称
   * @returns {boolean}
   */
  isDraggableFreePoint(objectName) {
    if (!this.isReady || !this.applet) {
      return false;
    }

    try {
      return (
        this.applet.getObjectType(objectName)?.toLowerCase() === 'point'
        && this.applet.isIndependent(objectName)
        && this.applet.isMoveable(objectName)
      );
    } catch (error) {
      console.warn(`判断自由点失败: ${objectName}`, error);
      return false;
    }
  }

  /**
   * 统一处理 GeoGebra 客户端事件里返回的对象名格式
   * @param {string|string[]} rawLabels - 原始标签
   * @returns {string[]}
   */
  normalizeObjectNames(rawLabels) {
    if (Array.isArray(rawLabels)) {
      return rawLabels.filter(Boolean);
    }

    if (typeof rawLabels === 'string') {
      return rawLabels
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
    }

    return [];
  }

  /**
   * 统一导出坐标的小数位，避免把编辑器刷成很长的小数串
   * @param {number} value - 坐标值
   * @returns {number}
   */
  formatNumber(value) {
    const rounded = Number.parseFloat(Number(value).toFixed(6));
    return Object.is(rounded, -0) ? 0 : rounded;
  }

  /**
   * 把十六进制颜色转换成 RGB，供 GeoGebra API 使用
   * @param {string} hex
   * @returns {{r: number, g: number, b: number}|null}
   */
  hexToRgb(hex) {
    if (typeof hex !== 'string') {
      return null;
    }

    const normalized = hex.trim().replace('#', '');
    if (!/^[0-9a-f]{6}$/i.test(normalized)) {
      return null;
    }

    return {
      r: Number.parseInt(normalized.slice(0, 2), 16),
      g: Number.parseInt(normalized.slice(2, 4), 16),
      b: Number.parseInt(normalized.slice(4, 6), 16),
    };
  }

  /**
   * 提取赋值语句左侧的对象名
   * @param {string} command - 原始命令
   * @returns {string|null}
   */
  extractAssignedObjectName(command) {
    if (typeof command !== 'string') {
      return null;
    }

    let depth = 0;
    let quote = null;
    let assignmentIndex = -1;

    for (let index = 0; index < command.length; index++) {
      const char = command[index];
      const prevChar = index > 0 ? command[index - 1] : '';

      if (quote) {
        if (char === quote && prevChar !== '\\') {
          quote = null;
        }
        continue;
      }

      if (char === '"' || char === '\'') {
        quote = char;
        continue;
      }

      if (char === '(' || char === '[' || char === '{') {
        depth++;
        continue;
      }

      if (char === ')' || char === ']' || char === '}') {
        depth = Math.max(depth - 1, 0);
        continue;
      }

      if (char === '=' && depth === 0) {
        assignmentIndex = index;
        break;
      }
    }

    if (assignmentIndex === -1) {
      return null;
    }

    const target = command.slice(0, assignmentIndex).trim();
    const match = target.match(GeoGebraEngine.ASSIGNMENT_TARGET_PATTERN);
    return match?.groups?.name ?? null;
  }
}

export default new GeoGebraEngine();
