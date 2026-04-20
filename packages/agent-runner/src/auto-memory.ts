/**
 * Automatic Memory System for MyClaw Agents
 *
 * This system automatically captures and saves important learnings
 * from conversations without requiring manual memory save commands.
 *
 * The system works by:
 * 1. Detecting important patterns in conversations (feedback, errors, discoveries)
 * 2. Scoring them by importance
 * 3. Saving high-value memories automatically via MyClaw IPC
 * 4. Providing hooks for manual memory extraction when needed
 */

import fs from 'fs';
import path from 'path';

export interface ConversationMetadata {
  userMessage: string;
  sessionId: string;
  timestamp: string;
  hasErrors: boolean;
}

export interface AutoMemoryConfig {
  enabled: boolean;
  importanceThreshold: number;
  maxMemoriesPerSession: number;
  saveUserFeedback: boolean;
  saveToolDiscoveries: boolean;
  saveWorkflowPatterns: boolean;
}

const DEFAULT_CONFIG: AutoMemoryConfig = {
  enabled: true,
  importanceThreshold: 0.6,
  maxMemoriesPerSession: 10,
  saveUserFeedback: true,
  saveToolDiscoveries: true,
  saveWorkflowPatterns: true,
};

/**
 * Analyzes conversation for important patterns worth remembering
 */
export function analyzeConversationMetadata(metadata: ConversationMetadata): {
  shouldSave: boolean;
  reason: string;
  priority: number;
} {
  let priority = 0;
  const reasons: string[] = [];

  // High priority: Error situations
  if (metadata.hasErrors) {
    priority += 0.3;
    reasons.push('conversation contained errors');
  }

  // Medium priority: User preferences or feedback
  const feedbackIndicators = [
    'prefer',
    'like',
    "don't like",
    'should',
    'should not',
    'always',
    'never',
    'works',
    "doesn't work",
  ];

  for (const indicator of feedbackIndicators) {
    if (metadata.userMessage.toLowerCase().includes(indicator)) {
      priority += 0.2;
      reasons.push(`user feedback detected: "${indicator}"`);
    }
  }

  // Medium priority: Technical/development context
  const technicalIndicators = [
    'api',
    'tool',
    'integration',
    'setup',
    'configure',
    'workflow',
    'process',
    'automation',
    'deploy',
  ];

  for (const indicator of technicalIndicators) {
    if (metadata.userMessage.toLowerCase().includes(indicator)) {
      priority += 0.1;
      reasons.push(`technical context: "${indicator}"`);
    }
  }

  return {
    shouldSave: priority >= DEFAULT_CONFIG.importanceThreshold,
    reason: reasons.join(', ') || 'standard conversation',
    priority: Math.min(priority, 1.0),
  };
}

/**
 * Extracts potential memory items from conversation metadata
 */
export function extractMemoryFromMetadata(
  metadata: ConversationMetadata,
): Array<{
  kind: string;
  key: string;
  value: string;
  confidence: number;
}> {
  const memories: Array<{
    kind: string;
    key: string;
    value: string;
    confidence: number;
  }> = [];

  // Extract user preferences
  const preferencePatterns = [
    /(?:i prefer|i like|i don't like|use|avoid|always|never)/gi,
  ];

  for (const pattern of preferencePatterns) {
    const matches = metadata.userMessage.match(pattern);
    if (matches) {
      memories.push({
        kind: 'preference',
        key: `user_preference_${Date.now()}`,
        value: matches[0],
        confidence: 0.7,
      });
    }
  }

  // Extract technical learnings
  if (metadata.hasErrors) {
    memories.push({
      kind: 'lesson',
      key: `error_learning_${Date.now()}`,
      value: `User encountered error during: ${metadata.userMessage.substring(0, 100)}`,
      confidence: 0.8,
    });
  }

  // Extract workflow mentions
  if (
    metadata.userMessage.toLowerCase().includes('workflow') ||
    metadata.userMessage.toLowerCase().includes('process')
  ) {
    memories.push({
      kind: 'context',
      key: `workflow_context_${Date.now()}`,
      value: metadata.userMessage.substring(0, 200),
      confidence: 0.6,
    });
  }

  return memories.slice(0, DEFAULT_CONFIG.maxMemoriesPerSession);
}

/**
 * Saves memories via MyClaw IPC system
 */
export function saveMemoriesViaIpc(
  memories: Array<{
    kind: string;
    key: string;
    value: string;
    confidence: number;
  }>,
  sessionId: string,
  ipcDir: string,
): boolean {
  try {
    const timestamp = Date.now();
    const memoryFile = path.join(
      ipcDir,
      'input',
      `auto_memory_${sessionId}_${timestamp}.json`,
    );

    const memoryRequest = {
      type: 'message',
      requestId: `auto_memory_${timestamp}`,
      action: 'memory_save',
      payload: {
        memories: memories.map((memory) => ({
          ...memory,
          source: `auto_memory_${sessionId}`,
          timestamp: new Date().toISOString(),
        })),
      },
    };

    fs.writeFileSync(memoryFile, JSON.stringify(memoryRequest, null, 2));
    return true;
  } catch (error) {
    console.error('Failed to save memories via IPC:', error);
    return false;
  }
}

/**
 * Main automatic memory processing function
 */
export function processAutomaticMemory(
  metadata: ConversationMetadata,
  sessionId: string,
  ipcDir: string,
): {
  processed: number;
  saved: number;
  skipped: string;
} {
  if (!DEFAULT_CONFIG.enabled) {
    return {
      processed: 0,
      saved: 0,
      skipped: 'Automatic memory is disabled in config',
    };
  }

  try {
    // Analyze if conversation is worth remembering
    const analysis = analyzeConversationMetadata(metadata);

    if (!analysis.shouldSave) {
      return {
        processed: 0,
        saved: 0,
        skipped: `Priority too low (${analysis.priority.toFixed(2)} < ${DEFAULT_CONFIG.importanceThreshold}): ${analysis.reason}`,
      };
    }

    // Extract memory items
    const memories = extractMemoryFromMetadata(metadata);

    if (memories.length === 0) {
      return {
        processed: 1,
        saved: 0,
        skipped: 'No significant patterns found',
      };
    }

    // Save memories
    const saved = saveMemoriesViaIpc(memories, sessionId, ipcDir);

    return {
      processed: memories.length,
      saved: saved ? memories.length : 0,
      skipped: saved ? '' : 'Failed to write IPC file',
    };
  } catch (error) {
    return {
      processed: 0,
      saved: 0,
      skipped: `Processing failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Configuration helper for tuning automatic memory behavior
 */
export function configureAutoMemory(config: Partial<AutoMemoryConfig>): void {
  Object.assign(DEFAULT_CONFIG, config);
}

/**
 * Get current auto-memory configuration
 */
export function getAutoMemoryConfig(): AutoMemoryConfig {
  return { ...DEFAULT_CONFIG };
}
