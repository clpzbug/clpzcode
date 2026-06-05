import capitalize from 'lodash-es/capitalize.js';
import * as React from 'react';
import { type Command, type CommandBase, type CommandResultDisplay, getCommandName, type PromptCommand } from '../../commands.js';
import { Box, Text } from '../../ink.js';
import { estimateSkillFrontmatterTokens, getSkillsPath } from '../../skills/loadSkillsDir.js';
import { getDisplayPath } from '../../utils/file.js';
import { formatTokens } from '../../utils/format.js';
import { getSettingSourceName, type SettingSource } from '../../utils/settings/constants.js';
import { plural } from '../../utils/stringUtils.js';
import { ConfigurableShortcutHint } from '../ConfigurableShortcutHint.js';
import { Dialog } from '../design-system/Dialog.js';
import FullWidthRow from '../design-system/FullWidthRow.js';

// Skills are always PromptCommands with CommandBase properties
type SkillCommand = CommandBase & PromptCommand;
type SkillSource = SettingSource | 'plugin' | 'mcp';
type Props = {
  onExit: (result?: string, options?: {
    display?: CommandResultDisplay;
  }) => void;
  commands: Command[];
};
function getSourceTitle(source: SkillSource): string {
  if (source === 'plugin') {
    return 'Plugin skills';
  }
  if (source === 'mcp') {
    return 'MCP skills';
  }
  return `${capitalize(getSettingSourceName(source))} skills`;
}
function getSourceSubtitle(source: SkillSource, skills: SkillCommand[]): string | undefined {
  // MCP skills show server names; file-based skills show filesystem paths.
  // Skill names are `<server>:<skill>`, not `mcp__<server>__…`.
  if (source === 'mcp') {
    const servers = [...new Set(skills.map(s => {
      const idx = s.name.indexOf(':');
      return idx > 0 ? s.name.slice(0, idx) : null;
    }).filter((n): n is string => n != null))];
    return servers.length > 0 ? servers.join(', ') : undefined;
  }
  const skillsPath = getDisplayPath(getSkillsPath(source, 'skills'));
  const hasCommandsSkills = skills.some(s => s.loadedFrom === 'commands_DEPRECATED');
  return hasCommandsSkills ? `${skillsPath}, ${getDisplayPath(getSkillsPath(source, 'commands'))}` : skillsPath;
}
function getSkillListLabel(skill: SkillCommand): string {
  const leafName = skill.name.split(':').pop() ?? skill.name;
  return leafName === skill.name ? skill.name : `${skill.name} - ${leafName}`;
}
function isSkillCommand(cmd: Command): cmd is SkillCommand {
  return cmd.type === 'prompt' && (cmd.loadedFrom === 'skills' || cmd.loadedFrom === 'commands_DEPRECATED' || cmd.loadedFrom === 'plugin' || cmd.loadedFrom === 'mcp');
}
function compareByName(a: SkillCommand, b: SkillCommand): number {
  return a.name.localeCompare(b.name);
}
function renderSkill(skill: SkillCommand) {
  const estimatedTokens = estimateSkillFrontmatterTokens(skill);
  const tokenDisplay = `~${formatTokens(estimatedTokens)}`;
  const pluginName = skill.source === 'plugin' ? skill.pluginInfo?.pluginManifest.name : undefined;
  return <FullWidthRow key={`${skill.name}-${skill.source}`} trailing={<Text dimColor={true}>{tokenDisplay}</Text>}><Text>{getSkillListLabel(skill)}</Text>{pluginName && <Text dimColor={true}> · {pluginName}</Text>}</FullWidthRow>;
}
export function SkillsMenu({ onExit, commands }: Props) {
  const skills = commands.filter(isSkillCommand);
  const skillsBySource: Record<SkillSource, SkillCommand[]> = {
    policySettings: [],
    userSettings: [],
    projectSettings: [],
    localSettings: [],
    flagSettings: [],
    plugin: [],
    mcp: []
  };
  for (const skill of skills) {
    const source = skill.source as SkillSource;
    if (source in skillsBySource) {
      skillsBySource[source].push(skill);
    }
  }
  for (const group of Object.values(skillsBySource)) {
    group.sort(compareByName);
  }
  const handleCancel = () => {
    onExit("Skills dialog dismissed", {
      display: "system"
    });
  };
  if (skills.length === 0) {
    return <Dialog title="Skills" subtitle="No skills found" onCancel={handleCancel} hideInputGuide={true}><FullWidthRow><Text dimColor={true}>Create skills in .claude/skills/&lt;name&gt;/SKILL.md or ~/.clpzcode/skills/&lt;name&gt;/SKILL.md</Text></FullWidthRow><FullWidthRow><Text dimColor={true} italic={true}><ConfigurableShortcutHint action="confirm:no" context="Confirmation" fallback="Esc" description="close" /></Text></FullWidthRow></Dialog>;
  }
  const renderSkillGroup = (source: SkillSource) => {
    const groupSkills = skillsBySource[source];
    if (groupSkills.length === 0) {
      return null;
    }
    const title = getSourceTitle(source);
    const subtitle = getSourceSubtitle(source, groupSkills);
    return <Box flexDirection="column" key={source}><FullWidthRow><Text bold={true} dimColor={true}>{title}</Text>{subtitle && <Text dimColor={true}> ({subtitle})</Text>}</FullWidthRow>{groupSkills.map(skill => renderSkill(skill))}</Box>;
  };
  const subtitle = `${skills.length} ${plural(skills.length, "skill")}`;
  return <Dialog title="Skills" subtitle={subtitle} onCancel={handleCancel} hideInputGuide={true}><Box flexDirection="column" gap={1}>{renderSkillGroup("projectSettings")}{renderSkillGroup("userSettings")}{renderSkillGroup("policySettings")}{renderSkillGroup("plugin")}{renderSkillGroup("mcp")}</Box><FullWidthRow><Text dimColor={true} italic={true}><ConfigurableShortcutHint action="confirm:no" context="Confirmation" fallback="Esc" description="close" /></Text></FullWidthRow></Dialog>;
}
