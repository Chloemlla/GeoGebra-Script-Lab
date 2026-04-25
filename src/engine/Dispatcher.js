/**
 * 指令调度与执行模块 (Dispatcher)
 * 负责：
 * 1. 顺序执行清洗后的指令
 * 2. 捕获执行错误
 * 3. 提供详细的执行报告
 * 4. 支持暂停/恢复执行
 */

class Dispatcher {
  constructor(engine) {
    this.engine = engine;
    this.isExecuting = false;
    this.executionLog = [];
    this.errors = [];
    this.warnings = [];
    this.onProgress = null;
    this.onError = null;
    this.onComplete = null;
    this.executionTimeout = 30000; // 30秒超时
  }

  /**
   * 执行指令序列
   * @param {array} commands - 清洗后的指令数组
   * @param {object} options - 执行选项 {resetBeforeRun, verbose}
   * @returns {promise} - 执行完成的 Promise
   */
  async execute(commands, options = {}) {
    const {
      resetBeforeRun = true,
      verbose = true,
    } = options;

    // 防止重复执行
    if (this.isExecuting) {
      console.warn('正在执行中，无法同时启动新的执行');
      return this.getExecutionReport();
    }

    // 清空之前的日志和错误
    this.executionLog = [];
    this.errors = [];
    this.warnings = [];

    // 等待引擎就绪
    if (!this.engine.isAppletReady()) {
      try {
        await this.engine.ready();
      } catch (err) {
        this.log(`引擎初始化失败: ${err.message}`, 'error');
        return this.getExecutionReport();
      }
    }

    // 重置画板到干净状态（解决脏画布问题）
    if (resetBeforeRun) {
      try {
        const resetSuccess = this.engine.reset();
        if (resetSuccess) {
          this.log('✓ 画板已重置为干净状态', 'info');
        }
      } catch (err) {
        this.log(`✗ 重置画板时出错: ${err.message}`, 'error');
      }
    }

    this.isExecuting = true;
    const startTime = Date.now();

    try {
      for (let i = 0; i < commands.length; i++) {
        const command = commands[i];

        // 检查总体超时：防止浏览器卡死（DoS 防护）
        const elapsedTime = Date.now() - startTime;
        if (elapsedTime > this.executionTimeout) {
          const timeoutError = {
            lineNumber: i + 1,
            command,
            message: `执行超时（已用时 ${elapsedTime}ms > ${this.executionTimeout}ms），已中止以防止浏览器卡死`,
            timestamp: new Date(),
          };
          this.errors.push(timeoutError);
          this.log(
            `⏱ 执行超时已停止。已成功执行 ${i}/${commands.length} 条指令`,
            'error',
            timeoutError
          );
          break;
        }

        // 报告进度
        this._reportProgress(i, commands.length, command);

        // 执行指令
        try {
          const success = this.engine.executeCommand(command);

          if (success) {
            this.log(`[${i + 1}] ✓ ${command}`, 'success');
          } else {
            const error = {
              lineNumber: i + 1,
              command,
              message: '指令执行失败（可能是语法错误、变量未定义、或数学逻辑错误）',
              timestamp: new Date(),
            };
            this.errors.push(error);
            this.log(`[${i + 1}] ✗ ${command}`, 'error', error);

            if (this.onError) {
              this.onError(error);
            }

            break;
          }
        } catch (err) {
          // 处理生命周期错误等异常
          const error = {
            lineNumber: i + 1,
            command,
            message: `执行异常: ${err.message}`,
            timestamp: new Date(),
          };
          this.errors.push(error);
          this.log(`[${i + 1}] ⚠ ${command}`, 'error', error);

          if (this.onError) {
            this.onError(error);
          }

          break;
        }
      }
    } catch (err) {
      console.error('指令执行过程中发生未捕获异常', err);
      this.errors.push({
        type: 'fatal_exception',
        message: err.message,
        timestamp: new Date(),
      });
    } finally {
      this.isExecuting = false;

      // 触发完成回调
      if (this.onComplete) {
        this.onComplete(this.getExecutionReport());
      }
    }

    return this.getExecutionReport();
  }

  /**
   * 记录日志
   * @param {string} message - 消息
   * @param {string} level - 日志级别 ('info', 'success', 'error', 'warning')
   * @param {object} data - 附加数据
   */
  log(message, level = 'info', data = null) {
    const logEntry = {
      message,
      level,
      timestamp: new Date(),
      data,
    };

    this.executionLog.push(logEntry);

    if (level === 'error') {
      console.error(message, data);
    } else if (level === 'warning') {
      console.warn(message, data);
    } else {
      console.log(message, data);
    }
  }

  /**
   * 报告进度
   * @private
   */
  _reportProgress(current, total, command) {
    if (this.onProgress) {
      this.onProgress({
        current: current + 1,
        total,
        percentage: Math.round(((current + 1) / total) * 100),
        currentCommand: command,
      });
    }
  }

  /**
   * 获取执行报告
   * @returns {object} - 完整的执行报告
   */
  getExecutionReport() {
    return {
      success: this.errors.length === 0,
      totalLog: this.executionLog.length,
      successCount: this.executionLog.filter(l => l.level === 'success').length,
      warningCount: this.warnings.length,
      errorCount: this.errors.length,
      errors: this.errors,
      warnings: this.warnings,
      logs: this.executionLog,
      timestamp: new Date(),
    };
  }

  /**
   * 获取错误列表
   * @returns {array}
   */
  getErrors() {
    return this.errors;
  }

  /**
   * 获取执行日志
   * @returns {array}
   */
  getLogs() {
    return this.executionLog;
  }

  /**
   * 清空日志
   */
  clearLogs() {
    this.executionLog = [];
    this.errors = [];
  }

  /**
   * 设置进度回调
   * @param {function} callback - 回调函数
   */
  setOnProgress(callback) {
    this.onProgress = callback;
  }

  /**
   * 设置错误回调
   * @param {function} callback - 回调函数
   */
  setOnError(callback) {
    this.onError = callback;
  }

  /**
   * 设置完成回调
   * @param {function} callback - 回调函数
   */
  setOnComplete(callback) {
    this.onComplete = callback;
  }

  /**
   * 获取执行状态
   * @returns {boolean}
   */
  getExecutionStatus() {
    return this.isExecuting;
  }

  /**
   * 生成执行摘要
   * @returns {string}
   */
  getSummary() {
    const report = this.getExecutionReport();
    return `
执行完成
━━━━━━━━━━━━━━━━━━
✓ 成功执行: ${report.successCount} 条指令
✗ 执行失败: ${report.errorCount} 条指令
📊 总计: ${report.totalLog} 条指令
━━━━━━━━━━━━━━━━━━
状态: ${report.success ? '✓ 全部成功' : '✗ 有错误'}
    `.trim();
  }
}

export default Dispatcher;
