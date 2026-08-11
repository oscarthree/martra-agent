import { describe, expect, it } from 'vitest';
import { weatherWorkflowInputSchema } from './weather-workflow';

describe('weatherWorkflow input', () => {
  it('defaults to a one-day forecast', () => {
    expect(weatherWorkflowInputSchema.parse({ city: 'Dalian' })).toEqual({
      city: 'Dalian',
      days: 1,
    });
  });

  it('accepts forecast lengths from one to seven days', () => {
    expect(weatherWorkflowInputSchema.parse({ city: 'Dalian', days: 1 }).days).toBe(1);
    expect(weatherWorkflowInputSchema.parse({ city: 'Dalian', days: 7 }).days).toBe(7);
  });

  it.each([0, 8, 1.5])('rejects invalid forecast length %s', (days) => {
    expect(() => weatherWorkflowInputSchema.parse({ city: 'Dalian', days })).toThrow();
  });

  it('requires a city', () => {
    expect(() => weatherWorkflowInputSchema.parse({ days: 2 })).toThrow();
  });
});
