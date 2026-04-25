/**
 * 预处理器模块 (Preprocessor)
 * 负责清洗用户输入的代码：
 * 1. 移除注释 (//)
 * 2. 移除空行
 * 3. 格式化指令
 * 4. 验证基本的语法
 * 5. 安全性检查（防DoS、XSS）
 */

class Preprocessor {
  // 安全性配置
  static CONFIG = {
    MAX_CODE_LENGTH: 50000,              // 最大代码长度
    MAX_COMMANDS: 5000,                  // 最大指令数
    MAX_SEQUENCE_DEPTH: 3,               // 最大嵌套深度
    MAX_ITERATION_COUNT: 10000,          // 最大迭代次数
    DANGEROUS_PATTERNS: [
      /javascript:/i,                    // JavaScript URL
      /<\s*script/i,                     // Script 标签
      /on\w+\s*=/i,                      // 事件处理器
      /eval\s*\(/i,                      // eval 函数
      /function\s*\(/i,                  // function 定义
    ],
    RISKY_FUNCTIONS: [
      'Sequence',                        // 序列生成
      'Iteration',                       // 迭代
      'RecursiveSequence',               // 递归序列
    ],
  };

  static IDENTIFIER_PATTERN = /^[_\p{L}][_\p{L}\p{N}'’]*$/u;
  /**
   * 清洗代码文本
   * @param {string} userCode - 原始代码文本
   * @returns {array} - 清洗后的指令数组
   * @throws {Error} - 如果代码不安全
   */
  static clean(userCode) {
    if (!userCode || typeof userCode !== 'string') {
      return [];
    }

    // 安全性检查：代码长度限制
    if (userCode.length > this.CONFIG.MAX_CODE_LENGTH) {
      throw new Error(
        `代码过长（${userCode.length} 字符 > ${this.CONFIG.MAX_CODE_LENGTH} 字符限制）。`
      );
    }

    // 安全性检查：XSS 防护
    const securityErrors = this.checkXSS(userCode);
    if (securityErrors.length > 0) {
      throw new Error(
        `检测到潜在的安全问题（XSS 风险）:\n${securityErrors.join('\n')}`
      );
    }

    const commands = userCode
      .split('\n')                          // 按行分割
      .map(line => this.removeLine(line))   // 移除注释
      .map(line => line.trim())             // 去掉前后空白
      .filter(line => line.length > 0);     // 过滤空行

    // 安全性检查：指令数量限制
    if (commands.length > this.CONFIG.MAX_COMMANDS) {
      throw new Error(
        `指令过多（${commands.length} > ${this.CONFIG.MAX_COMMANDS}），可能导致性能问题。`
      );
    }

    return commands;
  }

  /**
   * 移除单行注释
   * @param {string} line - 单行代码
   * @returns {string} - 移除注释后的代码
   */
  static removeLine(line) {
    // 匹配 // 及之后的内容（但要排除 URL 中的 //）
    // 简单策略：如果 // 不在字符串内，则移除它之后的内容
    const commentIndex = line.indexOf('//');
    
    if (commentIndex === -1) {
      return line;
    }

    // 检查 // 是否在字符串内
    const beforeComment = line.substring(0, commentIndex);
    const singleQuoteCount = (beforeComment.match(/'/g) || []).length;
    const doubleQuoteCount = (beforeComment.match(/"/g) || []).length;

    // 如果在字符串内（单引号或双引号的个数为奇数），保留 //
    if (singleQuoteCount % 2 === 1 || doubleQuoteCount % 2 === 1) {
      return line;
    }

    return beforeComment;
  }

  /**
   * 验证指令的基本有效性 + 安全性检查
   * @param {array} commands - 指令数组
   * @returns {object} - 验证结果 {valid: boolean, errors: array, warnings: array}
   */
  static validate(commands) {
    const errors = [];
    const warnings = [];

    commands.forEach((cmd, index) => {
      // 检查指令不为空
      if (!cmd || cmd.trim().length === 0) {
        errors.push({
          line: index + 1,
          message: '空指令',
        });
        return;
      }

      // 检查括号匹配
      if (!this.checkBrackets(cmd)) {
        errors.push({
          line: index + 1,
          message: '括号不匹配',
          command: cmd,
        });
      }

      // 检查顶层赋值语法，兼容 GeoGebra 的函数定义如 f(x) = ...
      const assignment = this.extractAssignment(cmd);
      if (assignment && !this.isValidAssignment(cmd)) {
        errors.push({
          line: index + 1,
          message: 'GeoGebra 赋值格式不正确',
          command: cmd,
        });
      }

      // 安全性检查：检查高风险函数（DoS 防护）
      const riskWarnings = this.checkRiskyFunctions(cmd, index + 1);
      warnings.push(...riskWarnings);

      // 安全性检查：检查嵌套深度
      const nestingWarnings = this.checkNestingDepth(cmd, index + 1);
      warnings.push(...nestingWarnings);
    });

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * 检查 XSS 风险
   * @param {string} code - 代码字符串
   * @returns {array} - 风险项列表
   */
  static checkXSS(code) {
    const risks = [];

    for (const pattern of this.CONFIG.DANGEROUS_PATTERNS) {
      if (pattern.test(code)) {
        risks.push(`检测到危险模式: ${pattern.source}`);
      }
    }

    return risks;
  }

  /**
   * 检查高风险函数
   * @param {string} command - 指令
   * @param {number} lineNum - 行号
   * @returns {array} - 警告项列表
   */
  static checkRiskyFunctions(command, lineNum) {
    const warnings = [];

    for (const func of this.CONFIG.RISKY_FUNCTIONS) {
      if (command.includes(func)) {
        warnings.push({
          line: lineNum,
          level: 'warning',
          message: `检测到高风险函数 "${func}"，可能导致性能问题（DoS 风险）`,
          command,
        });
      }
    }

    return warnings;
  }

  /**
   * 检查嵌套深度
   * @param {string} command - 指令
   * @param {number} lineNum - 行号
   * @returns {array} - 警告项列表
   */
  static checkNestingDepth(command, lineNum) {
    const warnings = [];

    // 计算括号嵌套深度
    let maxDepth = 0;
    let currentDepth = 0;

    for (const char of command) {
      if (char === '(') {
        currentDepth++;
        maxDepth = Math.max(maxDepth, currentDepth);
      } else if (char === ')') {
        currentDepth--;
      }
    }

    if (maxDepth > this.CONFIG.MAX_SEQUENCE_DEPTH) {
      warnings.push({
        line: lineNum,
        level: 'warning',
        message: `嵌套深度过深（${maxDepth} > ${this.CONFIG.MAX_SEQUENCE_DEPTH}），可能导致性能下降`,
        command,
      });
    }

    return warnings;
  }

  /**
   * 检查括号是否匹配
   * @param {string} command - 指令
   * @returns {boolean}
   */
  static checkBrackets(command) {
    const stack = [];
    const pairs = { '(': ')', '[': ']', '{': '}' };

    for (let char of command) {
      if (char in pairs) {
        stack.push(char);
      } else if (Object.values(pairs).includes(char)) {
        if (stack.length === 0 || pairs[stack.pop()] !== char) {
          return false;
        }
      }
    }

    return stack.length === 0;
  }

  /**
   * 提取顶层赋值语句，忽略字符串和括号内部的 =
   * @param {string} command - 指令
   * @returns {{left: string, right: string}|null}
   */
  static extractAssignment(command) {
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
        if (assignmentIndex !== -1) {
          return {
            left: '',
            right: '',
          };
        }

        assignmentIndex = index;
      }
    }

    if (assignmentIndex === -1) {
      return null;
    }

    return {
      left: command.slice(0, assignmentIndex).trim(),
      right: command.slice(assignmentIndex + 1).trim(),
    };
  }

  /**
   * 检查 GeoGebra 标签是否合法，兼容 A'、alpha、f(x) 等形式
   * @param {string} target - 赋值左侧
   * @returns {{name: string, params: string[]}|null}
   */
  static parseAssignmentTarget(target) {
    if (typeof target !== 'string') {
      return null;
    }

    const match = target.trim().match(
      /^(?<name>[_\p{L}][_\p{L}\p{N}'’]*)(?:\s*\((?<params>[^()]*)\))?$/u
    );

    if (!match?.groups?.name) {
      return null;
    }

    const params = typeof match.groups.params === 'string'
      ? match.groups.params
        .split(',')
        .map((param) => param.trim())
        .filter(Boolean)
      : [];

    return {
      name: match.groups.name,
      params,
    };
  }

  /**
   * 检查标签名是否合法
   * @param {string} value - 标签或参数名
   * @returns {boolean}
   */
  static isValidIdentifier(value) {
    return this.IDENTIFIER_PATTERN.test(value.trim());
  }

  /**
   * 检查赋值语句的有效性
   * @param {string} command - 指令
   * @returns {boolean}
   */
  static isValidAssignment(command) {
    const assignment = this.extractAssignment(command);
    if (!assignment) {
      return true;
    }

    const { left, right } = assignment;
    if (left.length === 0 || right.length === 0) {
      return false;
    }

    const target = this.parseAssignmentTarget(left);
    if (!target || !this.isValidIdentifier(target.name)) {
      return false;
    }

    return target.params.every((param) => this.isValidIdentifier(param));
  }

  /**
   * 获取代码统计信息
   * @param {string} userCode - 原始代码
   * @returns {object} - 统计信息
   */
  static getStats(userCode) {
    const lines = userCode.split('\n');
    const commands = this.clean(userCode);

    return {
      totalLines: lines.length,
      commandLines: commands.length,
      emptyLines: lines.filter(l => l.trim().length === 0).length,
      commentLines: lines.filter(l => l.trim().startsWith('//')).length,
    };
  }

  /**
   * 格式化单个指令
   * @param {string} command - 指令
   * @returns {string} - 格式化后的指令
   */
  static formatCommand(command) {
    // 移除多余空格
    return command
      .replace(/\s+/g, ' ')           // 多个空格替换为单个
      .replace(/\s*(=|\(|\)|,|\[|\]|\{|\})\s*/g, '$1') // 运算符周围的空格
      .trim();
  }

  /**
   * 提取指令中引用的变量
   * @param {array} commands - 指令数组
   * @returns {object} - {defined: array, referenced: array}
   */
  static extractVariables(commands) {
    const defined = [];
    const referenced = new Set();

    commands.forEach(cmd => {
      // 提取赋值的变量（定义）
      const assignment = this.extractAssignment(cmd);
      const target = assignment ? this.parseAssignmentTarget(assignment.left) : null;
      if (target) {
        defined.push(target.name);
      }

      // 提取所有引用的变量（粗略提取）
      const varPattern = /[_\p{L}][_\p{L}\p{N}'’]*/gu;
      const vars = cmd.match(varPattern) || [];
      vars.forEach(v => {
        // 排除 GeoGebra 内置函数和关键字
        if (!this.isGeoGebraKeyword(v)) {
          referenced.add(v);
        }
      });
    });

    return {
      defined,
      referenced: Array.from(referenced),
    };
  }

  /**
   * 检查是否为 GeoGebra 内置关键字/函数
   * @param {string} word - 单词
   * @returns {boolean}
   */
  static isGeoGebraKeyword(word) {
    const keywords = [
      // 函数
      'point', 'line', 'circle', 'ellipse', 'polygon', 'segment',
      'midpoint', 'perpendicular', 'perpendicularline', 'parallel', 'parallelline',
      'intersect', 'distance', 'angle', 'slope', 'tangent', 'text',
      'translate', 'rotate', 'area', 'slider',
      'sin', 'cos', 'tan', 'sqrt', 'abs', 'round', 'floor', 'ceil',
      'min', 'max', 'random', 'sequence',
      // 布尔值和常量
      'true', 'false', 'inf', 'pi', 'e',
      // 关键字
      'if', 'then', 'else', 'function',
    ];

    return keywords.includes(word.toLowerCase());
  }
}

export default Preprocessor;
