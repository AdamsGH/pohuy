import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);

// codex/src/controller.ts
import { readFileSync as readFileSync3 } from "node:fs";
import path3 from "node:path";
import os from "node:os";

// codex/src/core.ts
import { createHash, randomUUID } from "node:crypto";
import { readFileSync, existsSync, mkdirSync, openSync, writeFileSync, fsyncSync, closeSync, renameSync, unlinkSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// codex/src/prompt-text.ts
function formatPromptText(markdown, asciiDashes = false) {
  if (!asciiDashes) return markdown;
  let fence;
  let codeSpan = 0;
  return markdown.split("\n").map((line) => {
    const marker = /^(?:\s*>\s*)* {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (fence) {
      if (marker && marker[1][0] === fence.character && marker[1].length >= fence.length && !marker[2].trim()) fence = void 0;
      return line;
    }
    if (marker && !codeSpan) {
      fence = { character: marker[1][0], length: marker[1].length };
      return line;
    }
    if (/^(?: {4}|\t| {0,3}\[[^\]]+\]:)/.test(line)) return line;
    return line.split(/(`+|!?\[[^\]]*\]\([^)]*\)|<[^>]*>|https?:\/\/[^\s<>]+)/g).map((part) => {
      if (/^`+$/.test(part)) {
        if (!codeSpan) codeSpan = part.length;
        else if (codeSpan === part.length) codeSpan = 0;
        return part;
      }
      if (codeSpan || /^(?:!?\[|<|https?:\/\/)/.test(part)) return part;
      return part.replaceAll("—", "-");
    }).join("");
  }).join("\n");
}

// extensions/pohuy/style-source.ts
var TIERS = ["lite", "full", "ultra"];
var SKILL_PATH = new URL("../../skills/pohuy/SKILL.md", import.meta.url);
var SLOVAR_PATH = new URL("../../skills/pohuy/references/slovar.md", import.meta.url);
var SCENES_PATH = new URL("../../skills/pohuy/references/sceny.md", import.meta.url);
var HUENITIV_PATH = new URL("../../skills/pohuy/references/huenitiv.md", import.meta.url);
var HUENITIV_OPTION_ID = "huenitiv:rules";
var LEGACY_HUENITIV_OPTION_ID = "skill:Хуенитивы";
var CORE_SKILL_SECTIONS = [
  "Persistence",
  "Правила",
  "Шкала состояний проекта",
  "Auto-Clarity (мат выключается)",
  "Boundaries"
];
var OPTIONAL_SKILL_SECTIONS = [
  "Словарь (рабочий минимум)"
];
var SCENE_FRAMING = "Сцены задают тон, а не готовый текст. Не цитируй их дословно. Адаптируй к ситуации.";
var DEFAULT_ULTRA_SCENES = [
  "Легаси-археология",
  "Каскадный отказ",
  "Триумф после долгого дебага"
];
var NON_OPTIONAL_DICTIONARY_PREFIXES = ["Чего в словаре нет"];
var DICTIONARY_DESCRIPTIONS = {
  "Состояния и статусы": "Слова для описания состояния проекта, от штатной работы до полного отказа.",
  "Действия": "Глаголы для работы, ошибок, исправлений, ожидания и бесполезной возни.",
  "Оценки и количества": "Слова для масштаба, количества, уверенности и значимости.",
  "Сущности": "Названия для кода, артефактов, процессов и прочих технических сущностей."
};
var WORKING_MINIMUM_OVERLAPS = {
  [sourceId("slovar", "Состояния и статусы")]: "Состояние:",
  [sourceId("slovar", "Действия")]: "Действия:",
  [sourceId("slovar", "Оценки и количества")]: "Связки и оценки:",
  [sourceId("slovar", "Сущности")]: "Сущности:"
};
var WORKING_MINIMUM_LABELS = [...Object.values(WORKING_MINIMUM_OVERLAPS), "Присказки"];
function extractHeadingSection(markdown, depth, heading, source) {
  const lines = markdown.split("\n");
  const marker = `${"#".repeat(depth)} ${heading}`;
  const start = lines.findIndex((line) => line.trimEnd() === marker);
  if (start === -1) throw new Error(`В ${source} нет раздела: ${heading}`);
  const next = lines.findIndex((line, index) => {
    if (index <= start) return false;
    const match = line.match(/^(#{1,6})\s/);
    return match !== null && match[1].length <= depth;
  });
  const body = lines.slice(start + 1, next === -1 ? void 0 : next).join("\n").trim();
  if (!body) throw new Error(`Empty ${source} section: ${heading}`);
  return `${marker}

${body}`;
}
function extractSkillSection(markdown, heading) {
  return extractHeadingSection(markdown, 2, heading, "SKILL.md");
}
function headingsAtDepth(markdown, depth) {
  const prefix = `${"#".repeat(depth)} `;
  return markdown.split("\n").filter((line) => line.startsWith(prefix) && !line.startsWith(`${prefix}#`)).map((line) => line.slice(prefix.length).trim()).filter(Boolean);
}
function requiredHeadingWithPrefix(markdown, depth, prefix) {
  const heading = headingsAtDepth(markdown, depth).find((candidate) => candidate.startsWith(prefix));
  if (!heading) throw new Error(`Нет заголовка, начинающегося с: ${prefix}`);
  return heading;
}
function sourceId(source, heading) {
  return `${source}:${heading}`;
}
function plainMarkdownText(text) {
  return text.replace(/^>\s?/gm, "").replace(/^[-*]\s+/gm, "").replace(/\[([^\]]+)]\([^)]+\)/g, "$1").replace(/\*\*([^*]+)\*\*/g, "$1").replace(/`([^`]+)`/g, "$1").replace(/\s+/g, " ").trim();
}
function firstContentBlock(content) {
  const lines = content.split("\n").slice(1);
  const start = lines.findIndex((line) => line.trim() !== "");
  if (start === -1) return "";
  const endOffset = lines.slice(start).findIndex((line) => line.trim() === "");
  const end = endOffset === -1 ? lines.length : start + endOffset;
  return plainMarkdownText(lines.slice(start, end).join("\n"));
}
function headingLine(markdown, depth, heading) {
  const marker = `${"#".repeat(depth)} ${heading}`;
  const index = markdown.split("\n").findIndex((line) => line.trimEnd() === marker);
  return index < 0 ? 1 : index + 1;
}
function stableNodeId(_source, optionId, _line, label) {
  return `item:${optionId}:${label.toLocaleLowerCase("ru-RU")}`;
}
function entryLabel(markdown) {
  const bold = markdown.match(/^\s*-\s+\*\*([^*]+)\*\*/);
  if (bold) return bold[1].trim();
  const quoted = markdown.match(/^\s*-\s+[«"]([^»"]+)[»"]/);
  if (quoted) return quoted[1].trim();
  return plainMarkdownText(markdown).split(/\s+[—–-]\s+/)[0].trim();
}
function entryDescription(markdown) {
  const plain = plainMarkdownText(markdown);
  const separator = plain.match(/\s+[—–-]\s+/);
  return separator ? plain.slice((separator.index ?? 0) + separator[0].length).trim() : plain;
}
function parseDictionaryNodes(optionId, heading, sectionContent, sectionLine, section = "dictionary", path4 = "references/slovar.md") {
  const lines = sectionContent.split("\n");
  const root = {
    id: `group:${optionId}`,
    kind: "group",
    section,
    label: heading,
    description: DICTIONARY_DESCRIPTIONS[heading] ?? firstContentBlock(sectionContent),
    markdown: sectionContent,
    path: path4,
    line: sectionLine,
    aliases: [],
    children: [],
    optionId
  };
  let parent = root;
  for (let index = 1; index < lines.length; index += 1) {
    const line = lines[index];
    const subgroup = line.match(/^([^#*`].+):\s*$/);
    const nextContent = lines.slice(index + 1).find((candidate) => candidate.trim() !== "");
    if (subgroup && nextContent && /^\s*-\s+/.test(nextContent)) {
      const label2 = subgroup[1].trim();
      parent = {
        id: stableNodeId("slovar", optionId, sectionLine + index, label2),
        kind: "group",
        section,
        label: label2,
        description: `Подгруппа раздела "${heading}".`,
        markdown: line,
        path: path4,
        line: sectionLine + index,
        aliases: [],
        children: [],
        optionId
      };
      root.children.push(parent);
      continue;
    }
    if (!/^\s*-\s+/.test(line)) continue;
    const block = [line];
    while (index + 1 < lines.length && !/^\s*-\s+/.test(lines[index + 1]) && !/^\S.+:\s*$/.test(lines[index + 1])) {
      if (lines[index + 1].trim() === "" && (index + 2 >= lines.length || !/^\s{2,}\S/.test(lines[index + 2]))) break;
      block.push(lines[index + 1]);
      index += 1;
    }
    const markdown = block.join("\n").trimEnd();
    const label = entryLabel(markdown);
    parent.children.push({
      id: stableNodeId("slovar", optionId, sectionLine + index - block.length + 1, label),
      kind: "entry",
      section,
      label,
      description: entryDescription(markdown),
      markdown,
      path: path4,
      line: sectionLine + index - block.length + 1,
      aliases: label.split(/\s*\/\s*/).filter((alias) => alias !== label),
      children: [],
      optionId
    });
  }
  return [root];
}
function sourceOption(source, heading, content, fullSource) {
  const depth = source === "sceny" ? 3 : 2;
  const path4 = source === "skill" ? "SKILL.md" : source === "slovar" ? "references/slovar.md" : "references/sceny.md";
  const line = headingLine(fullSource, depth, heading);
  const id = sourceId(source, heading);
  return {
    id,
    section: source === "skill" ? "skill" : source === "slovar" ? "dictionary" : "scenes",
    label: heading,
    description: source === "slovar" ? DICTIONARY_DESCRIPTIONS[heading] ?? firstContentBlock(content) : firstContentBlock(content),
    content,
    path: path4,
    line,
    nodes: source === "slovar" ? parseDictionaryNodes(id, heading, content, line) : source === "skill" ? parseDictionaryNodes(id, heading, content, line, "skill", "SKILL.md") : []
  };
}
function huenitivOption(content) {
  return {
    id: HUENITIV_OPTION_ID,
    section: "skill",
    label: "Хуенитивы",
    description: "Правила рифмованных замен через дефис. По умолчанию включены в ultra, но доступны в любом активном режиме.",
    content: compileRuntimeMarkdown(content).replace(/ Только в режиме \*\*ultra\*\*\./u, ""),
    path: "references/huenitiv.md",
    line: 1,
    nodes: []
  };
}
function extractTierPolicy(levels, examplesSource, tier) {
  const tableRow = levels.split("\n").find((line) => line.startsWith(`| **${tier}** |`));
  if (!tableRow) throw new Error(`В таблице SKILL.md нет режима: ${tier}`);
  const description = tableRow.split("|")[2]?.trim().replace(/\s+Default\.$/u, "");
  if (!description) throw new Error(`В таблице SKILL.md нет описания режима: ${tier}`);
  const examples = [];
  const exampleLines = examplesSource.split("\n");
  for (let index = 0; index < exampleLines.length; index += 1) {
    if (!exampleLines[index].startsWith(`- ${tier}:`)) continue;
    const block = [exampleLines[index]];
    while (index + 1 < exampleLines.length && /^\s{2,}\S/.test(exampleLines[index + 1])) {
      block.push(exampleLines[index + 1]);
      index += 1;
    }
    examples.push(block.join("\n").replace(new RegExp(`^- ${tier}:`), "-"));
  }
  if (examples.length === 0) throw new Error(`В SKILL.md нет примеров для режима: ${tier}`);
  return [`## Уровень: ${tier}`, description, `Примеры:
${examples.join("\n")}`].join("\n\n");
}
function compileRuntimeMarkdown(markdown) {
  return markdown.replace(/^## Persistence$/gmu, "## Постоянство стиля").replace(/^## Auto-Clarity \(мат выключается\)$/gmu, "## Ясность в критических ситуациях").replace(/^## Boundaries$/gmu, "## Границы").replace(/^- Security-предупреждения$/gmu, "- Предупреждения безопасности").replace(/^Default:.*$/gmu, "").replace(/ Выключение только: «нормальный режим» \/ «хватит материться»\.$/gmu, "").replace(/ «нормальный режим» — выключение\.$/gmu, "").replace(/^Уровень держится до смены или конца сессии\.\s*$/gmu, "").replace(/\s+Полные примеры по каждой — в `references\/sceny\.md`\./gu, "").replace(/^Полная версия с маппингами — в `references\/slovar\.md`\.\s*$/gmu, "").replace(/^Полный арсенал образности — в `references\/slovar\.md`\.\s*$/gmu, "").replace(/\s+Теория — в `ontologia\.md`\./gu, "").replace(/\n{3,}/g, "\n\n").trim();
}
function sceneCategory(markdown, sceneLine) {
  let category = "Сцены";
  for (const [index, line] of markdown.split("\n").entries()) {
    if (index + 1 >= sceneLine) break;
    const match = line.match(/^##\s+(.+)$/);
    if (match) category = match[1].trim();
  }
  return category;
}
function buildSourceRoots(options, documents) {
  const skillOptions = options.filter((option) => option.section === "skill");
  const huenitiv = skillOptions.find((option) => option.id === HUENITIV_OPTION_ID);
  const dictionaryOptions = options.filter((option) => option.section === "dictionary");
  const sceneOptions = options.filter((option) => option.section === "scenes");
  const skillRoot = {
    id: "component:style-skill",
    kind: "component",
    section: "skill",
    label: "Стилевой skill",
    description: "Подключает правила ответа из SKILL.md. Словарь, сцены и хуенитивы включаются отдельно.",
    markdown: documents.skill,
    path: "SKILL.md",
    line: 1,
    aliases: ["pohuy", "style"],
    children: []
  };
  for (const option of skillOptions.filter((candidate) => candidate.id !== HUENITIV_OPTION_ID)) {
    skillRoot.children.push({
      id: `component:${option.id}`,
      kind: "group",
      section: "skill",
      label: option.label,
      description: option.description,
      markdown: option.content,
      path: option.path,
      line: option.line,
      aliases: [],
      children: option.nodes[0]?.children ?? [],
      optionId: option.id
    });
  }
  const dictionaryResource = {
    id: "component:dictionary-resource",
    kind: "component",
    section: "skill",
    label: "Рабочий словарь",
    description: "Слова и выражения из references/slovar.md. Их можно включать по одному или группами.",
    markdown: documents.dictionary,
    path: "references/slovar.md",
    line: 1,
    aliases: ["dictionary", "словарь"],
    children: []
  };
  const scenesResource = {
    id: "component:scenes-resource",
    kind: "component",
    section: "skill",
    label: "Сцены",
    description: "Примеры ответов для состояний проекта и типичных ситуаций.",
    markdown: documents.scenes,
    path: "references/sceny.md",
    line: 1,
    aliases: ["scenes", "сцены"],
    children: []
  };
  const huenitivResource = huenitiv && {
    id: "component:huenitiv-resource",
    kind: "component",
    section: "skill",
    label: huenitiv.label,
    description: huenitiv.description,
    markdown: documents.huenitiv,
    path: huenitiv.path,
    line: huenitiv.line,
    aliases: ["huenitiv", "хуенитив", "рифма"],
    children: [],
    optionId: huenitiv.id
  };
  const sceneGroups = /* @__PURE__ */ new Map();
  for (const option of sceneOptions) {
    const category = option.nodes[0]?.category ?? "Сцены";
    let group = sceneGroups.get(category);
    if (!group) {
      group = {
        id: `scene-group:${category}`,
        kind: "group",
        section: "scenes",
        label: category,
        description: category === "Шкала состояний проекта" ? "Десять состояний проекта: от триумфа до катастрофы." : "Примеры ответов для типичных ситуаций.",
        markdown: "",
        path: "references/sceny.md",
        line: option.line,
        aliases: [],
        children: [],
        category
      };
      sceneGroups.set(category, group);
    }
    group.children.push(...option.nodes);
  }
  return {
    skill: [skillRoot, dictionaryResource, scenesResource, ...huenitivResource ? [huenitivResource] : []],
    dictionary: dictionaryOptions.flatMap((option) => option.nodes),
    scenes: [...sceneGroups.values()]
  };
}
function parseStyleSource({ skill, dictionary: slovar, scenes, huenitiv }) {
  const levels = extractSkillSection(skill, "Уровни");
  const nonOptionalDictionaryHeading = requiredHeadingWithPrefix(
    slovar,
    2,
    NON_OPTIONAL_DICTIONARY_PREFIXES[0]
  );
  const common = [
    ...CORE_SKILL_SECTIONS.map((heading) => compileRuntimeMarkdown(extractSkillSection(skill, heading))),
    compileRuntimeMarkdown(extractHeadingSection(slovar, 2, nonOptionalDictionaryHeading, "slovar.md")),
    SCENE_FRAMING
  ];
  const options = [
    ...OPTIONAL_SKILL_SECTIONS.map(
      (heading) => sourceOption("skill", heading, extractSkillSection(skill, heading), skill)
    ),
    huenitivOption(huenitiv),
    ...headingsAtDepth(slovar, 2).filter(
      (heading) => !NON_OPTIONAL_DICTIONARY_PREFIXES.some((prefix) => heading.startsWith(prefix))
    ).map(
      (heading) => sourceOption("slovar", heading, extractHeadingSection(slovar, 2, heading, "slovar.md"), slovar)
    ),
    ...headingsAtDepth(scenes, 3).map((heading) => {
      const option = sourceOption("sceny", heading, extractHeadingSection(scenes, 3, heading, "sceny.md"), scenes);
      const category = sceneCategory(scenes, option.line);
      option.nodes = [{
        id: `scene:${option.id}`,
        kind: "scene",
        section: "scenes",
        label: heading,
        description: option.description,
        markdown: option.content,
        path: option.path,
        line: option.line,
        aliases: [],
        children: [],
        optionId: option.id,
        category
      }];
      return option;
    })
  ];
  const source = {
    common,
    options,
    roots: buildSourceRoots(options, {
      skill,
      dictionary: slovar,
      scenes,
      huenitiv
    }),
    tiers: Object.fromEntries(
      TIERS.map((tier) => [tier, extractTierPolicy(levels, skill, tier)])
    )
  };
  assertDefaultSections(source);
  return source;
}
function defaultSectionIds(tier) {
  if (tier === "lite" || tier === "normal") return [];
  const full = OPTIONAL_SKILL_SECTIONS.map((heading) => sourceId("skill", heading));
  if (tier === "full") return full;
  return [
    ...full,
    HUENITIV_OPTION_ID,
    sourceId("slovar", "Образность: восклицания, звукопись, присказки"),
    ...DEFAULT_ULTRA_SCENES.map((heading) => sourceId("sceny", heading))
  ];
}
function assertDefaultSections(source) {
  const known = new Set(source.options.map((option) => option.id));
  const required = /* @__PURE__ */ new Set([
    ...defaultSectionIds("full"),
    ...defaultSectionIds("ultra")
  ]);
  const missing = [...required].filter((id) => !known.has(id));
  if (missing.length > 0) throw new Error(`Не найдены стандартные разделы: ${missing.join(", ")}`);
}
function canonicalSectionId(id) {
  return id === LEGACY_HUENITIV_OPTION_ID ? HUENITIV_OPTION_ID : id;
}
function selectedSectionIds(settings, source) {
  const selected = new Set((settings.selectedSections ?? defaultSectionIds(settings.tier)).map(canonicalSectionId));
  return source.options.filter((option) => selected.has(option.id)).map((option) => option.id);
}
function effectiveSectionIds(settings, source) {
  return settings.tier === "normal" ? [] : selectedSectionIds(settings, source);
}
function removeWorkingMinimumOverlaps(content, selected) {
  const removedLabels = new Set(
    Object.entries(WORKING_MINIMUM_OVERLAPS).filter(([id]) => selected.has(id)).map(([, label]) => label)
  );
  if (removedLabels.size === 0) return content;
  const lines = content.split("\n");
  const result = [];
  let skipping = false;
  for (const line of lines) {
    const trimmed = line.trim();
    const label = WORKING_MINIMUM_LABELS.find(
      (candidate) => candidate === "Присказки" ? trimmed.startsWith("Присказки") : trimmed === candidate
    );
    if (label) skipping = removedLabels.has(label);
    if (!skipping) result.push(line);
  }
  return result.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
function selectTierVariant(content, tier) {
  const lines = content.split("\n");
  const result = [];
  let skippingVariant = false;
  let pendingBlankLines = [];
  for (const line of lines) {
    const variant = line.match(/^- (lite|full|ultra):/);
    if (variant) {
      pendingBlankLines = [];
      skippingVariant = variant[1] !== tier;
      if (!skippingVariant) result.push(line);
      continue;
    }
    if (skippingVariant) {
      if (line.trim() === "") {
        pendingBlankLines.push(line);
        continue;
      }
      if (/^\s{2,}\S/.test(line)) {
        pendingBlankLines = [];
        continue;
      }
      result.push(...pendingBlankLines);
      pendingBlankLines = [];
      skippingVariant = false;
    }
    result.push(line);
  }
  return result.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
function compileSelectedOption(option, selected, tier) {
  let content = option.content;
  if (option.id === sourceId("skill", "Словарь (рабочий минимум)")) {
    content = removeWorkingMinimumOverlaps(content, selected);
  }
  return compileRuntimeMarkdown(selectTierVariant(content, tier));
}
function flattenNodes(nodes) {
  return nodes.flatMap((node) => [node, ...flattenNodes(node.children)]);
}
function inheritedEntryEnabled(node, settings, source) {
  return node.optionId !== void 0 && selectedSectionIds(settings, source).includes(node.optionId);
}
function entryEnabled(node, settings, source) {
  const override = settings.itemOverrides?.[node.id];
  if (override !== void 0) return override;
  return inheritedEntryEnabled(node, settings, source);
}
function explicitlyDisabledTerms(settings, source) {
  const entries = flattenNodes([
    ...source.roots.skill,
    ...source.roots.dictionary
  ]).filter((node) => node.kind === "entry" && settings.itemOverrides?.[node.id] === false);
  return new Set(
    entries.flatMap((entry) => [entry.label, ...entry.aliases]).filter(Boolean).map((term) => term.toLocaleLowerCase("ru"))
  );
}
function matchesExplicitlyDisabledTerm(node, disabledTerms) {
  return [node.label, ...node.aliases].some((term) => disabledTerms.has(term.toLocaleLowerCase("ru")));
}
function compileListOption(option, settings, source, disabledTerms) {
  const root = option.nodes[0];
  if (!root) return option.content;
  const enabled = (node) => entryEnabled(node, settings, source) && !matchesExplicitlyDisabledTerm(node, disabledTerms);
  const enabledEntries = flattenNodes([root]).filter((node) => node.kind === "entry" && enabled(node));
  if (enabledEntries.length === 0) return void 0;
  const originalLines = option.content.split("\n");
  const firstStructural = Math.min(...root.children.map((node) => node.line - option.line));
  const intro = originalLines.slice(0, firstStructural < 0 ? 1 : firstStructural).join("\n").trimEnd();
  const blocks = [intro];
  let entryRun = [];
  const flushEntryRun = () => {
    if (entryRun.length > 0) blocks.push(entryRun.join("\n"));
    entryRun = [];
  };
  for (const child of root.children) {
    if (child.kind === "group") {
      flushEntryRun();
      const entries = child.children.filter((entry) => entry.kind === "entry" && enabled(entry));
      if (entries.length > 0) blocks.push(`${child.markdown}

${entries.map((entry) => entry.markdown).join("\n")}`);
    } else if (child.kind === "entry" && enabled(child)) {
      entryRun.push(child.markdown);
    }
  }
  flushEntryRun();
  return compileRuntimeMarkdown(blocks.filter(Boolean).join("\n\n"));
}
function buildStylePolicy(settings, source) {
  const tier = settings.tier;
  if (tier === "normal" || settings.skillEnabled === false) return void 0;
  const selected = new Set(effectiveSectionIds(settings, source));
  const disabledTerms = explicitlyDisabledTerms(settings, source);
  const policy = [
    ...source.common,
    ...source.options.map((option) => {
      if (option.section === "dictionary") return compileListOption(option, settings, source, disabledTerms);
      const hasEntries = flattenNodes(option.nodes).some((node) => node.kind === "entry");
      if (option.section === "skill" && hasEntries) {
        const compiled = compileListOption(option, settings, source, disabledTerms);
        return compiled ? removeWorkingMinimumOverlaps(compiled, selected) : void 0;
      }
      return selected.has(option.id) ? compileSelectedOption(option, selected, tier) : void 0;
    }),
    source.tiers[tier]
  ].filter(Boolean).join("\n\n");
  return policy;
}
var STYLE_PROMPT_LEAD = "Стиль ответов: Pohuy. Применяй его только к обычному тексту ответа. Не меняй вызовы и результаты инструментов, структурированные данные и инструкции с более высоким приоритетом.";
function buildStylePrompt(settings, source) {
  const policy = buildStylePolicy(settings, source);
  if (!policy || settings.tier === "normal") return void 0;
  return [STYLE_PROMPT_LEAD, policy].join("\n\n");
}

// codex/src/core.ts
var moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
var ROOT = path.resolve(moduleDirectory, "../..");
var TIERS2 = ["off", "lite", "full", "ultra"];
var DEFAULT_PREFERENCES = {
  autoApply: true,
  answerLength: "short",
  dryHumor: true,
  workingDictionary: true,
  calibrationExamples: true,
  rhymingForms: true,
  ontology: false,
  asciiDashes: false
};
function preferences(settings) {
  const result = { ...DEFAULT_PREFERENCES };
  for (const key of Object.keys(result)) {
    const value2 = settings[key];
    if (value2 === void 0) continue;
    if (key === "answerLength") {
      if (!["short", "adaptive", "detailed"].includes(value2)) throw new Error("Некорректная настройка длины ответа.");
      result.answerLength = value2;
    } else {
      if (typeof value2 !== "boolean") throw new Error(`Некорректная настройка: ${key}.`);
      result[key] = value2;
    }
  }
  return result;
}
var ARTIFACT_RULE = "Apply Pohuy only to chat replies. Keep authored project artifacts professional and free of profanity. Preserve each artifact's established language, style, and terminology. Preserve literal values, quotations, examples, and translations. If an artifact already uses Russian, continue in Russian without a separate request. Use English when the artifact has no established language. Explicit language and localization requests take priority. Use neutral, literal wording for security warnings, irreversible actions, and recovery instructions.";
function isTier(value2) {
  return TIERS2.includes(value2);
}
function dataDirectory(explicit2) {
  const value2 = explicit2 ?? process.env.PLUGIN_DATA ?? process.env.POHUY_DATA_DIR;
  if (!value2 || !path.isAbsolute(value2)) throw new Error("Не задан абсолютный каталог данных плагина.");
  return path.resolve(value2);
}
function readSettings(directory) {
  let settings;
  try {
    settings = JSON.parse(readFileSync(path.join(directory, "settings.json"), "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return { version: 1, tier: "full" };
    throw new Error("Не удалось прочитать настройки Pohuy. Исправь файл до смены режима.", { cause: error });
  }
  if (!settings || typeof settings !== "object" || Array.isArray(settings) || settings.version !== 1 || !isTier(settings.tier)) {
    throw new Error("Неподдерживаемый формат настроек Pohuy. Ожидается version: 1 и допустимый tier.");
  }
  preferences(settings);
  return settings;
}
function atomicWrite(filename, bytes, mode = 384) {
  const temporary = path.join(path.dirname(filename), `.${path.basename(filename)}.${randomUUID()}`);
  let fd;
  try {
    fd = openSync(temporary, "wx", mode);
    writeFileSync(fd, bytes);
    fsyncSync(fd);
    closeSync(fd);
    fd = void 0;
    renameSync(temporary, filename);
  } finally {
    if (fd !== void 0) closeSync(fd);
    try {
      unlinkSync(temporary);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
}
function updateSettings(directory, patch, root = ROOT) {
  const settings = { ...readSettings(directory), ...patch };
  if (!isTier(settings.tier)) throw new Error("Неизвестный режим Pohuy.");
  preferences(settings);
  styleContext(settings.tier, root, settings);
  mkdirSync(directory, { recursive: true, mode: 448 });
  atomicWrite(path.join(directory, "settings.json"), JSON.stringify(settings, null, 2) + "\n");
  return settings;
}
function setTier(directory, tier) {
  if (!isTier(tier)) throw new Error("Неизвестный режим Pohuy.");
  return updateSettings(directory, { tier });
}
function loadSource(root = ROOT) {
  const packaged = path.join(root, "codex/style/SKILL.md");
  const skill = readFileSync(existsSync(packaged) ? packaged : path.join(root, "skills/pohuy/SKILL.md"), "utf8");
  const reference = (name) => readFileSync(path.join(root, "skills/pohuy/references", name + ".md"), "utf8");
  return parseStyleSource({ skill, dictionary: reference("slovar"), scenes: reference("sceny"), huenitiv: reference("huenitiv") });
}
function modeContext(tier, root = ROOT) {
  const guidance = tier === "off" ? "Use ordinary chat without Pohuy styling." : loadSource(root).tiers[tier].split("\n\n")[1];
  return `Pohuy mode: ${tier}. This supersedes earlier mode selections. ${guidance}
${ARTIFACT_RULE}`;
}
function preferenceContext(settings) {
  const p = preferences(settings);
  const length = {
    short: "Keep replies short: lead with the result and include only necessary details. Explicit requests for detail take precedence.",
    adaptive: "Match reply length to the task. Keep answers to simple questions short. Explain reasoning and evidence when useful.",
    detailed: "Give thorough explanations with reasoning, evidence, and useful examples. Keep the structure clear and follow explicit requests for brevity."
  };
  return `Pohuy response preferences: ${length[p.answerLength]} ${p.dryHumor ? "Use dry, situational irony when appropriate." : "Use direct, literal wording without jokes or sarcasm. Idiomatic engineering emphasis remains allowed."} ${p.rhymingForms && settings.tier === "ultra" ? "Rhyming forms are allowed in ultra mode." : "Rhyming forms are disabled."} These preferences take priority over conflicting chat examples. Keep project artifacts professional. Keep security warnings, irreversible actions, and recovery instructions clear.`;
}
function styleContext(tier, root = ROOT, settings = { version: 1, tier }) {
  if (tier === "off") return modeContext(tier, root);
  const source = loadSource(root);
  const p = preferences(settings);
  const profile = { tier };
  profile.selectedSections = source.options.filter(
    (option) => option.section === "dictionary" && p.workingDictionary || option.section === "scenes" && p.calibrationExamples || option.id.startsWith("skill:Словарь") && p.workingDictionary || option.id === "huenitiv:rules" && p.rhymingForms && tier === "ultra"
  ).map((option) => option.id);
  const ontology = p.ontology ? readFileSync(path.join(root, "skills/pohuy/references/ontologia.md"), "utf8") : "";
  const context = [buildStylePrompt(profile, source), ontology, modeContext(tier, root), preferenceContext({ ...settings, tier })].filter(Boolean).join("\n\n");
  return formatPromptText(context, p.asciiDashes);
}
function promptTier(prompt) {
  const match = /^(?:\/pohuy|\$pohuy(?::pohuy)?)\s+(off|normal|lite|full|ultra)$/.exec(prompt.trim());
  return match ? match[1] === "normal" ? "off" : match[1] : void 0;
}
function hook(event, payload, directory, root = ROOT) {
  if (!["SessionStart", "UserPromptSubmit"].includes(event) || payload.hook_event_name !== event || typeof payload.session_id !== "string" || !payload.session_id) throw new Error("Некорректное событие хука.");
  if (event === "UserPromptSubmit" && typeof payload.prompt !== "string") throw new Error("Некорректный prompt хука.");
  const sessionFile = path.join(directory, "sessions", createHash("sha256").update(payload.session_id).digest("hex") + ".json");
  let previous;
  try {
    previous = JSON.parse(readFileSync(sessionFile, "utf8"));
  } catch {
    previous = void 0;
  }
  const requested = event === "UserPromptSubmit" ? promptTier(payload.prompt) : void 0;
  const settings = { ...readSettings(directory), ...requested ? { tier: requested } : {} };
  const tier = settings.tier;
  const p = preferences(settings);
  const fingerprint = createHash("sha256").update(JSON.stringify({ tier, ...p })).digest("hex");
  let context;
  if (!p.autoApply && !requested) context = modeContext("off") + "\nAutomatic Pohuy activation is disabled. Apply the saved profile only when the user invokes Pohuy explicitly in this turn.";
  else context = requested || event === "SessionStart" || previous !== fingerprint ? styleContext(tier, root, settings) : modeContext(tier, root) + "\n" + preferenceContext(settings);
  if (requested) updateSettings(directory, { tier }, root);
  if (previous !== fingerprint || event === "SessionStart") {
    mkdirSync(path.dirname(sessionFile), { recursive: true, mode: 448 });
    atomicWrite(sessionFile, JSON.stringify(fingerprint));
  }
  return { hookSpecificOutput: { hookEventName: event, additionalContext: formatPromptText(context, p.asciiDashes) } };
}

// codex/src/migration.ts
import { readFileSync as readFileSync2, lstatSync, mkdirSync as mkdirSync2 } from "node:fs";
import { randomUUID as randomUUID2 } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import path2 from "node:path";
var REMINDER = "Pohuy style is active. Remember to follow the specific guidelines of the Pohuy Style section in AGENTS.md.";
function removeBlocks(bytes) {
  const text = bytes.toString("latin1");
  const tokens = [...text.matchAll(/^<!-- pohuy:(start|end) -->\r?$/gm)];
  if (tokens.length !== [...text.matchAll(/<!-- pohuy:(?:start|end) -->/g)].length) throw new Error("Маркеры Pohuy должны занимать полные строки.");
  const ranges = [];
  let start;
  for (const token of tokens) {
    if (token[1] === "start" && start === void 0) start = token.index;
    else if (token[1] === "end" && start !== void 0) {
      let end = token.index + token[0].length;
      if (text[end] === "\n") end++;
      ranges.push([start, end]);
      start = void 0;
    } else throw new Error("Маркеры Pohuy вложены или несбалансированы.");
  }
  if (start !== void 0) throw new Error("Нет закрывающего маркера Pohuy.");
  let result = bytes;
  for (const [start2, end] of ranges.reverse()) result = Buffer.concat([result.subarray(0, start2), result.subarray(end)]);
  return result;
}
function isLegacyReminder(handler) {
  if (handler.type !== "command" || typeof handler.command !== "string") return false;
  const match = /^\s*echo\s+(?:'([^']*)'|"((?:[^"\\]|\\.)*)")\s*$/.exec(handler.command);
  if (!match) return false;
  const text = match[1] ?? match[2].replace(/\\(["\\$`])/g, "$1");
  try {
    return isDeepStrictEqual(JSON.parse(text), { hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: REMINDER } });
  } catch {
    return false;
  }
}
function removeReminder(bytes) {
  const data = JSON.parse(bytes.toString("utf8"));
  if (!data || typeof data !== "object" || Array.isArray(data) || data.hooks !== void 0 && (!data.hooks || typeof data.hooks !== "object" || Array.isArray(data.hooks))) throw new Error("В hooks.json ожидается объект hooks.");
  const groups = data.hooks?.UserPromptSubmit ?? [];
  if (!Array.isArray(groups)) throw new Error("UserPromptSubmit должен содержать массив.");
  let changed = false;
  const remaining = groups.flatMap((group) => {
    if (!group || typeof group !== "object" || !Array.isArray(group.hooks) || group.hooks.some((h) => !h || typeof h !== "object" || Array.isArray(h))) throw new Error("Некорректная группа хуков.");
    const hooks = group.hooks.filter((h) => !isLegacyReminder(h));
    if (hooks.length === group.hooks.length) return [group];
    changed = true;
    return hooks.length ? [{ ...group, hooks }] : [];
  });
  if (!changed) return bytes;
  data.hooks.UserPromptSubmit = remaining;
  return Buffer.from(JSON.stringify(data, null, 2) + "\n");
}
function migrate(home, apply = false, write = atomicWrite) {
  const changes = [];
  for (const [name, transform] of [["AGENTS.md", removeBlocks], ["hooks.json", removeReminder]]) {
    const filename = path2.join(home, name);
    let stat;
    try {
      stat = lstatSync(filename);
    } catch (error) {
      if (error.code === "ENOENT") continue;
      throw error;
    }
    if (stat.isSymbolicLink()) throw new Error(`Миграция не заменяет символическую ссылку: ${filename}`);
    const original = readFileSync2(filename);
    const updated = transform(original);
    if (!original.equals(updated)) changes.push({ filename, original, updated, mode: stat.mode & 511 });
  }
  const result = { applied: false, changed_files: changes.map((c) => c.filename), backup_dir: null };
  if (!apply || !changes.length) return result;
  const backup = path2.join(home, "pohuy-migration-backups", `${(/* @__PURE__ */ new Date()).toISOString().replaceAll(":", "")}-${randomUUID2()}`);
  mkdirSync2(backup, { recursive: true, mode: 448 });
  for (const c of changes) write(path2.join(backup, path2.basename(c.filename)), c.original);
  const installed = [];
  try {
    for (const c of changes) {
      if (lstatSync(c.filename).isSymbolicLink() || !readFileSync2(c.filename).equals(c.original)) throw new Error(`Файл изменился во время миграции: ${c.filename}`);
      write(c.filename, c.updated, c.mode);
      installed.push(c);
    }
  } catch (error) {
    const failures = [];
    for (const c of installed.reverse()) {
      try {
        write(c.filename, c.original, c.mode);
      } catch (e) {
        failures.push(e.message);
      }
    }
    throw new Error(`Миграция не завершена: ${error.message}. Резервные копии: ${backup}. ${failures.join("; ")}`);
  }
  return { ...result, applied: true, backup_dir: backup };
}

// codex/src/controller.ts
var args = process.argv.slice(2);
var dataIndex = args.indexOf("--data-dir");
var explicit = dataIndex >= 0 ? args.splice(dataIndex, 2)[1] : void 0;
var [command, value] = args;
try {
  let result;
  if (command === "migrate") {
    const homeIndex = args.indexOf("--codex-home");
    const home = homeIndex >= 0 ? args[homeIndex + 1] : process.env.CODEX_HOME ?? process.env.CODEX_DIR ?? path3.join(os.homedir(), ".codex");
    if (!home) throw new Error("Не задан каталог Codex.");
    result = migrate(path3.resolve(home), args.includes("--apply"));
  } else {
    const directory = dataDirectory(explicit);
    if (command === "hook") result = hook(value, JSON.parse(readFileSync3(0, "utf8")), directory);
    else if (command === "status") result = { tier: readSettings(directory).tier };
    else if (command === "set") {
      const tier = value === "normal" ? "off" : value;
      if (!isTier(tier)) throw new Error("Допустимые режимы: off, lite, full, ultra.");
      const context = styleContext(tier, void 0, { ...readSettings(directory), tier });
      result = { saved: true, tier: setTier(directory, tier).tier, context };
    } else throw new Error("Команды: status, set <режим>, hook <событие>, migrate [--apply].");
  }
  console.log(JSON.stringify(result));
} catch (error) {
  console.error(`Pohuy: ${error.message}`);
  if (command === "hook") console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: value, additionalContext: "Pohuy could not load its settings or style. Use ordinary chat and report the hook error. " + ARTIFACT_RULE } }));
  else process.exitCode = 1;
}
