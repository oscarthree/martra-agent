import { describe, expect, it } from 'vitest';
import { generalAgent } from './general-agent';
import { weatherAgent } from './weather-agent';
import { SessionMemory } from './shared';
import { agents } from './index';

describe('generalAgent definition', () => {
  it('is registered under the expected agent id', () => {
    expect(generalAgent.id).toBe('general-agent');
  });

  it('is registered under the generalAgent key used as runtimeAgentId', () => {
    expect(agents.generalAgent).toBe(generalAgent);
  });

  it('has no tools or workflows configured', async () => {
    expect(Object.keys(await generalAgent.listTools())).toEqual([]);
    expect(Object.keys(await generalAgent.listWorkflows())).toEqual([]);
  });

  it('uses the shared SessionMemory', async () => {
    expect(await generalAgent.getMemory()).toBeInstanceOf(SessionMemory);
  });

  it('shares the SessionMemory mechanism with the weather agent', async () => {
    expect(await weatherAgent.getMemory()).toBeInstanceOf(SessionMemory);
  });
});
