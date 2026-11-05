import { describe, expect, it } from 'vitest';
import { deployedServices } from '../src/gateway/instance-aggregator.service';

describe('deployedServices', () => {
  it('treats an unset or empty value as every service', () => {
    expect(deployedServices(undefined)).toBeNull();
    expect(deployedServices('')).toBeNull();
    expect(deployedServices(' , ')).toBeNull();
  });

  it('treats all as every service', () => {
    expect(deployedServices('all')).toBeNull();
  });

  it('parses the list and always includes the gateway', () => {
    const set = deployedServices(' identity-service, task-service ');
    expect(set?.has('identity-service')).toBe(true);
    expect(set?.has('task-service')).toBe(true);
    expect(set?.has('api-gateway')).toBe(true);
    expect(set?.has('quality-service')).toBe(false);
  });
});
