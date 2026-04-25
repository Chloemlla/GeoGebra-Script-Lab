import Preprocessor from '../engine/Preprocessor';

export const STUDIO_STORAGE_KEY = 'geograba-studio-v1';
export const MAX_RECENT_PROJECTS = 6;
export const MAX_PROJECT_VERSIONS = 24;

const NUMBER_PATTERN = /^-?\d+(?:\.\d+)?$/;
const BOOLEAN_PATTERN = /^(true|false)$/i;

const createId = (prefix) =>
  `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

const toIsoNow = () => new Date().toISOString();

const normalizeArray = (value) => (Array.isArray(value) ? value : []);

export const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const parseTagsInput = (value) => {
  if (typeof value !== 'string') {
    return [];
  }

  return Array.from(
    new Set(
      value
        .split(/[,，]/)
        .map((item) => item.trim())
        .filter(Boolean)
    )
  );
};

export const formatTagsInput = (tags) => normalizeArray(tags).join(', ');

export const formatScalarValue = (value) => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const rounded = Number.parseFloat(value.toFixed(6));
    return Object.is(rounded, -0) ? '0' : `${rounded}`;
  }

  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }

  if (typeof value === 'string') {
    return JSON.stringify(value);
  }

  return `${value}`;
};

export const createVersionRecord = ({
  id = createId('ver'),
  label = '手动快照',
  code = '',
  canvasModeId = 'geometry',
  createdAt = toIsoNow(),
  trigger = 'manual',
} = {}) => ({
  id,
  label,
  code,
  canvasModeId,
  createdAt,
  trigger,
});

export const createProjectRecord = ({
  id = createId('proj'),
  title = '未命名项目',
  folder = '个人空间',
  tags = [],
  isFavorite = false,
  canvasModeId = 'geometry',
  code = '',
  createdAt = toIsoNow(),
  updatedAt = createdAt,
  lastOpenedAt = updatedAt,
  versions = [],
} = {}) => ({
  id,
  title,
  folder,
  tags: normalizeArray(tags),
  isFavorite,
  canvasModeId,
  code,
  createdAt,
  updatedAt,
  lastOpenedAt,
  versions: normalizeArray(versions),
});

export const sortProjects = (projects) =>
  normalizeArray(projects)
    .slice()
    .sort((left, right) => {
      if (left.isFavorite !== right.isFavorite) {
        return left.isFavorite ? -1 : 1;
      }

      return new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
    });

export const readStudioState = () => {
  if (typeof window === 'undefined' || !window.localStorage) {
    return {
      projects: [],
      currentProjectId: null,
    };
  }

  try {
    const raw = window.localStorage.getItem(STUDIO_STORAGE_KEY);
    if (!raw) {
      return {
        projects: [],
        currentProjectId: null,
      };
    }

    const parsed = JSON.parse(raw);
    return {
      projects: sortProjects(parsed?.projects),
      currentProjectId: typeof parsed?.currentProjectId === 'string' ? parsed.currentProjectId : null,
    };
  } catch (_error) {
    return {
      projects: [],
      currentProjectId: null,
    };
  }
};

export const writeStudioState = ({ projects, currentProjectId }) => {
  if (typeof window === 'undefined' || !window.localStorage) {
    return;
  }

  window.localStorage.setItem(
    STUDIO_STORAGE_KEY,
    JSON.stringify({
      projects: sortProjects(projects),
      currentProjectId: currentProjectId ?? null,
    })
  );
};

export const upsertProject = (projects, project) => {
  const nextProjects = normalizeArray(projects).filter((item) => item.id !== project.id);
  nextProjects.unshift(project);
  return sortProjects(nextProjects);
};

export const attachVersionToProject = (project, version) => {
  const versions = [version, ...normalizeArray(project.versions)].slice(0, MAX_PROJECT_VERSIONS);
  return {
    ...project,
    versions,
    updatedAt: toIsoNow(),
  };
};

export const buildRecentProjects = (projects) =>
  sortProjects(projects)
    .slice()
    .sort((left, right) => {
      return new Date(right.lastOpenedAt).getTime() - new Date(left.lastOpenedAt).getTime();
    })
    .slice(0, MAX_RECENT_PROJECTS);

export const summarizeCodeDiff = (baseCode, nextCode) => {
  const beforeLines = `${baseCode ?? ''}`.split('\n');
  const afterLines = `${nextCode ?? ''}`.split('\n');
  const maxLength = Math.max(beforeLines.length, afterLines.length);
  const changedSamples = [];
  let changedLines = 0;
  let addedLines = 0;
  let removedLines = 0;

  for (let index = 0; index < maxLength; index++) {
    const beforeLine = beforeLines[index] ?? null;
    const afterLine = afterLines[index] ?? null;

    if (beforeLine === afterLine) {
      continue;
    }

    if (beforeLine === null) {
      addedLines++;
    } else if (afterLine === null) {
      removedLines++;
    } else {
      changedLines++;
    }

    if (changedSamples.length < 5) {
      changedSamples.push({
        lineNumber: index + 1,
        before: beforeLine,
        after: afterLine,
      });
    }
  }

  return {
    beforeLineCount: beforeLines.length,
    afterLineCount: afterLines.length,
    changedLines,
    addedLines,
    removedLines,
    changedSamples,
  };
};

export const buildPointCommandDiffs = (sourceCode, pointStates) => {
  const lines = `${sourceCode ?? ''}`.split('\n');

  return normalizeArray(pointStates)
    .map((state) => {
      const pattern = new RegExp(
        `^(\\s*)${escapeRegExp(state.name)}\\s*=\\s*\\(([^()]*)\\)\\s*(//.*)?$`
      );

      let beforeCommand = null;
      let lineNumber = null;

      lines.some((line, index) => {
        if (pattern.test(line)) {
          beforeCommand = line.trim();
          lineNumber = index + 1;
          return true;
        }

        return false;
      });

      return {
        ...state,
        lineNumber,
        beforeCommand,
        afterCommand: state.command,
        isNew: beforeCommand === null,
        hasChanged: beforeCommand !== state.command,
      };
    })
    .sort((left, right) => left.name.localeCompare(right.name, 'zh-CN'));
};

export const mergeCanvasStateIntoCode = (sourceCode, pointStates) => {
  if (!Array.isArray(pointStates) || pointStates.length === 0) {
    return sourceCode;
  }

  const remainingStates = new Map(pointStates.map((state) => [state.name, state.command]));
  const updatedLines = `${sourceCode ?? ''}`.split('\n').map((line) => {
    for (const [name, command] of remainingStates) {
      const pattern = new RegExp(
        `^(\\s*)${escapeRegExp(name)}\\s*=\\s*\\(([^()]*)\\)\\s*(//.*)?$`
      );
      const match = line.match(pattern);

      if (match) {
        remainingStates.delete(name);
        return `${match[1]}${command}${match[3] ? ` ${match[3]}` : ''}`;
      }
    }

    return line;
  });

  if (remainingStates.size === 0) {
    return updatedLines.join('\n');
  }

  const appendedLines = Array.from(remainingStates.values());
  const baseCode = updatedLines.join('\n');
  const separator = baseCode.trim().length > 0 ? '\n\n' : '';

  return `${baseCode}${separator}// 从画布同步的自由点\n${appendedLines.join('\n')}`;
};

export const extractParameterControls = (sourceCode) => {
  let commands = [];

  try {
    commands = Preprocessor.clean(sourceCode);
  } catch (_error) {
    return [];
  }

  return commands
    .map((command, index) => {
      const assignment = Preprocessor.extractAssignment(command);
      if (!assignment) {
        return null;
      }

      const target = Preprocessor.parseAssignmentTarget(assignment.left);
      if (!target || target.params.length > 0) {
        return null;
      }

      const rawValue = assignment.right.trim();

      if (NUMBER_PATTERN.test(rawValue)) {
        const numericValue = Number.parseFloat(rawValue);
        const absolute = Math.max(Math.abs(numericValue), 1);
        return {
          id: target.name,
          name: target.name,
          type: 'number',
          lineNumber: index + 1,
          command,
          rawValue,
          value: numericValue,
          min: Number.parseFloat((numericValue - absolute * 4).toFixed(2)),
          max: Number.parseFloat((numericValue + absolute * 4).toFixed(2)),
          step: absolute < 1 ? 0.1 : absolute < 10 ? 0.5 : 1,
        };
      }

      if (BOOLEAN_PATTERN.test(rawValue)) {
        return {
          id: target.name,
          name: target.name,
          type: 'boolean',
          lineNumber: index + 1,
          command,
          rawValue,
          value: /^true$/i.test(rawValue),
        };
      }

      const stringMatch = rawValue.match(/^"(.*)"$/);
      if (stringMatch) {
        return {
          id: target.name,
          name: target.name,
          type: 'string',
          lineNumber: index + 1,
          command,
          rawValue,
          value: stringMatch[1],
        };
      }

      return null;
    })
    .filter(Boolean);
};

export const replaceAssignmentValue = (sourceCode, name, nextValue) => {
  const formattedValue = formatScalarValue(nextValue);
  const pattern = new RegExp(
    `^(\\s*)${escapeRegExp(name)}\\s*=\\s*(.+?)(\\s*//.*)?$`
  );

  return `${sourceCode ?? ''}`
    .split('\n')
    .map((line) => {
      const match = line.match(pattern);
      if (!match) {
        return line;
      }

      return `${match[1]}${name} = ${formattedValue}${match[3] ?? ''}`;
    })
    .join('\n');
};

export const appendInsightCommentsToCode = (sourceCode, insights) => {
  if (!insights || typeof insights !== 'object') {
    return sourceCode;
  }

  const commentLines = [
    '// AI 图形解读',
    ...(insights.summary ? [`// 概要：${insights.summary}`] : []),
    ...normalizeArray(insights.keyPoints).map((item) => `// 关键点：${item}`),
  ];

  if (commentLines.length === 1) {
    return sourceCode;
  }

  return `${commentLines.join('\n')}\n\n${sourceCode ?? ''}`.trimEnd();
};

export const downloadTextFile = (filename, content, mimeType = 'text/plain;charset=utf-8') => {
  if (typeof document === 'undefined') {
    return;
  }

  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
};
