import type {
  API,
  Characteristic,
  DynamicPlatformPlugin,
  Logging,
  PlatformAccessory,
  PlatformConfig,
  Service,
} from 'homebridge';

import { PingHostAccessory } from './platformAccessory.js';
import { PLATFORM_NAME, PLUGIN_NAME } from './settings.js';

export interface HostConfig {
  name: string;
  ipv4_address?: string;
  ipv6_address?: string;
  mac_address?: string;
  host?: string; // legacy
  interval?: number;
  timeout?: number;
  retries?: number;
  startup_as_failed?: boolean;
  closed_on_success?: boolean;
  type?: string;
}

export class PingHostsPlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service;
  public readonly Characteristic: typeof Characteristic;

  public readonly accessories: Map<string, PlatformAccessory> = new Map();
  private readonly discoveredUUIDs: string[] = [];

  constructor(
    public readonly log: Logging,
    public readonly config: PlatformConfig,
    public readonly api: API,
  ) {
    this.Service = api.hap.Service;
    this.Characteristic = api.hap.Characteristic;

    this.api.on('didFinishLaunching', () => {
      this.discoverDevices();
    });
  }

  configureAccessory(accessory: PlatformAccessory) {
    this.log.info('Loading accessory from cache:', accessory.displayName);
    this.accessories.set(accessory.UUID, accessory);
  }

  discoverDevices() {
    const hosts: HostConfig[] = this.config.hosts || [];

    for (const hostConfig of hosts) {
      if (!hostConfig.name) {
        this.log.error('Host config missing name, skipping');
        continue;
      }

      const uuid = this.api.hap.uuid.generate(hostConfig.name);
      const existingAccessory = this.accessories.get(uuid);

      if (existingAccessory) {
        this.log.info('Restoring existing accessory from cache:', existingAccessory.displayName);
        existingAccessory.context.hostConfig = hostConfig;
        this.api.updatePlatformAccessories([existingAccessory]);
        new PingHostAccessory(this, existingAccessory);
      } else {
        this.log.info('Adding new accessory:', hostConfig.name);
        const accessory = new this.api.platformAccessory(hostConfig.name, uuid);
        accessory.context.hostConfig = hostConfig;
        new PingHostAccessory(this, accessory);
        this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
      }

      this.discoveredUUIDs.push(uuid);
    }

    for (const [uuid, accessory] of this.accessories) {
      if (!this.discoveredUUIDs.includes(uuid)) {
        this.log.info('Removing existing accessory from cache:', accessory.displayName);
        this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
      }
    }
  }
}
