import * as React from 'react';
import { Box } from '../ink.js';
import { useAppState } from '../state/AppState.js';
import type { AgentDefinitionsResult } from '../tools/AgentTool/loadAgentsDir.js';
import type { MemoryFileInfo } from '../utils/claudemd.js';
import { getMemoryFiles } from '../utils/claudemd.js';
import { getGlobalConfig } from '../utils/config.js';
import { getActiveNotices, type StatusNoticeContext } from '../utils/statusNoticeDefinitions.js';
type Props = {
  agentDefinitions?: AgentDefinitionsResult;
};

let cachedMemoryFiles: MemoryFileInfo[] = [];
let memoryFilesPromise: Promise<void> | null = null;

async function loadMemoryFiles(): Promise<void> {
  if (memoryFilesPromise) {
    return memoryFilesPromise;
  }
  memoryFilesPromise = getMemoryFiles().then(files => {
    cachedMemoryFiles = files;
  }).finally(() => {
    memoryFilesPromise = null;
  });
  return memoryFilesPromise;
}

/**
 * StatusNotices contains the information displayed to users at startup. We have
 * moved neutral or positive status to src/components/Status.tsx instead, which
 * users can access through /status.
 */
export function StatusNotices({ agentDefinitions }: Props) {
  const [memoryFiles, setMemoryFiles] = React.useState(cachedMemoryFiles);
  React.useEffect(() => {
    if (cachedMemoryFiles.length > 0) {
      setMemoryFiles(cachedMemoryFiles);
      return;
    }
    void loadMemoryFiles().then(() => {
      setMemoryFiles(cachedMemoryFiles);
    }).catch(() => {});
  }, []);
  const config = getGlobalConfig();
  const permissionMode = useAppState(s => s.toolPermissionContext?.mode);
  const mainLoopModel = useAppState(s => s.mainLoopModel);
  const context: StatusNoticeContext = {
    config,
    agentDefinitions,
    memoryFiles,
    permissionMode,
    mainLoopModel: mainLoopModel ?? undefined,
  };
  const activeNotices = getActiveNotices(context);
  if (activeNotices.length === 0) {
    return null;
  }
  return (
    <Box flexDirection="column" paddingLeft={1}>
      {activeNotices.map(notice => <React.Fragment key={notice.id}>{notice.render(context)}</React.Fragment>)}
    </Box>
  );
}
