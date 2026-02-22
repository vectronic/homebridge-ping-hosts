import type { CharacteristicValue, PlatformAccessory, Service } from 'homebridge';

import ping from 'ping';
import arp from '@network-utils/arp-lookup';

import type { PingHostsPlatform } from './platform.js';
import type { HostConfig } from './platform.js';

export class PingHostAccessory {
  private readonly service: Service;
  private readonly config: HostConfig;
  private state: CharacteristicValue;
  private readonly successState: CharacteristicValue;
  private readonly failureState: CharacteristicValue;
  private readonly ipv4Address?: string;
  private readonly ipv6Address?: string;
  private readonly macAddress?: string;
  private readonly retries: number;
  private readonly timeout: number;
  private readonly pingInterval: number;

  constructor(
    private readonly platform: PingHostsPlatform,
    private readonly accessory: PlatformAccessory,
  ) {
    const hostConfig = accessory.context.hostConfig as HostConfig;
    this.config = hostConfig;

    this.retries = hostConfig.retries ?? 1;
    this.timeout = hostConfig.timeout ?? 25;
    this.pingInterval = (hostConfig.interval ?? 60) * 1000;

    // Resolve addresses with priority
    let ipv4 = hostConfig.ipv4_address || hostConfig.host;
    const ipv6 = hostConfig.ipv6_address;
    let mac = hostConfig.mac_address;

    if (!ipv4 && !ipv6 && !mac) {
      this.platform.log.error('[' + hostConfig.name + '] specify one of ipv6_address, ipv4_address or mac_address!');
    }

    if (ipv6 && (ipv4 || mac)) {
      this.platform.log.error('[' + hostConfig.name + '] multiple addresses specified, ipv6_address will be used');
      ipv4 = undefined;
      mac = undefined;
    } else if (ipv4 && mac) {
      this.platform.log.error('[' + hostConfig.name + '] multiple addresses specified, ipv4_address will be used');
      mac = undefined;
    }

    this.ipv4Address = ipv4;
    this.ipv6Address = ipv6;
    this.macAddress = mac;

    const closedOnSuccess = hostConfig.closed_on_success !== false;
    const startupAsFailed = hostConfig.startup_as_failed !== false;
    const type = (hostConfig.type || 'ContactSensor').toLowerCase();

    this.platform.log.info('[' + hostConfig.name + '] closed_on_success: ' + closedOnSuccess);
    this.platform.log.info('[' + hostConfig.name + '] startup_as_failed: ' + startupAsFailed);

    // Set accessory information
    this.accessory.getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'vectronic')
      .setCharacteristic(this.platform.Characteristic.Model, 'Ping State Sensor');

    // Determine sensor type and states
    if (type === 'contactsensor') {
      if (closedOnSuccess) {
        this.successState = this.platform.Characteristic.ContactSensorState.CONTACT_DETECTED;
        this.failureState = this.platform.Characteristic.ContactSensorState.CONTACT_NOT_DETECTED;
      } else {
        this.successState = this.platform.Characteristic.ContactSensorState.CONTACT_NOT_DETECTED;
        this.failureState = this.platform.Characteristic.ContactSensorState.CONTACT_DETECTED;
      }
      this.service = this.accessory.getService(this.platform.Service.ContactSensor)
        || this.accessory.addService(this.platform.Service.ContactSensor);
      const characteristic = this.service.getCharacteristic(this.platform.Characteristic.ContactSensorState);
      this.state = startupAsFailed ? this.failureState : this.successState;
      characteristic.updateValue(this.state);
      characteristic.onGet(() => this.state);
    } else if (type === 'motionsensor') {
      if (closedOnSuccess) {
        this.successState = true;
        this.failureState = false;
      } else {
        this.successState = false;
        this.failureState = true;
      }
      this.service = this.accessory.getService(this.platform.Service.MotionSensor)
        || this.accessory.addService(this.platform.Service.MotionSensor);
      const characteristic = this.service.getCharacteristic(this.platform.Characteristic.MotionDetected);
      this.state = startupAsFailed ? this.failureState : this.successState;
      characteristic.updateValue(this.state);
      characteristic.onGet(() => this.state);
    } else {
      // Lightbulb
      if (closedOnSuccess) {
        this.successState = true;
        this.failureState = false;
      } else {
        this.successState = false;
        this.failureState = true;
      }
      this.service = this.accessory.getService(this.platform.Service.Lightbulb)
        || this.accessory.addService(this.platform.Service.Lightbulb);
      const characteristic = this.service.getCharacteristic(this.platform.Characteristic.On);
      this.state = startupAsFailed ? this.failureState : this.successState;
      characteristic.updateValue(this.state);
      characteristic.onGet(() => this.state);
      characteristic.onSet((value: CharacteristicValue) => {
        this.platform.log.debug('[' + hostConfig.name + '] ignoring request to set value to ' + value + ', current: ' + this.state);
        characteristic.updateValue(this.state);
      });
    }

    this.service.setCharacteristic(this.platform.Characteristic.Name, hostConfig.name);

    // Remove services that don't match the current type (handles type changes)
    const serviceTypes = [this.platform.Service.ContactSensor, this.platform.Service.MotionSensor, this.platform.Service.Lightbulb];
    for (const serviceType of serviceTypes) {
      if (serviceType !== this.service.constructor) {
        const oldService = this.accessory.getService(serviceType);
        if (oldService) {
          this.accessory.removeService(oldService);
        }
      }
    }

    // Start pinging
    setInterval(() => this.doPing(), this.pingInterval);
  }

  private async doPing(): Promise<void> {
    const target = this.ipv6Address || this.ipv4Address || this.macAddress;
    let resolvedAddress = this.ipv6Address || this.ipv4Address;

    try {
      if (this.macAddress && !resolvedAddress) {
        try {
          resolvedAddress = await arp.toIP(this.macAddress) ?? undefined;
          this.platform.log.debug('[' + this.config.name + '] ARP lookup result: ' + this.macAddress + ' => ' + resolvedAddress);
        } catch (e) {
          throw new Error('[' + this.config.name + '] ARP lookup failed: ' + e);
        }
      }

      if (!resolvedAddress) {
        throw new Error('[' + this.config.name + '] no address resolved');
      }

      let i = 0;
      while (true) {
        try {
          const result = await ping.promise.probe(resolvedAddress, {
            timeout: this.timeout,
            v6: this.ipv6Address !== undefined,
          });
          this.platform.log.debug('[' + this.config.name + '] result: ' + JSON.stringify(result));
          if (!result.alive) {
            throw new Error('not alive');
          }
          break;
        } catch (e) {
          i++;
          if (i >= this.retries) {
            throw e;
          } else {
            this.platform.log.debug('[' + this.config.name + '] not alive for ' + target + ', retrying');
          }
        }
      }

      this.platform.log.debug('[' + this.config.name + '] success for ' + target);
      this.state = this.successState;
      this.service.updateCharacteristic(
        this.getStateCharacteristic(),
        this.state,
      );
    } catch (e) {
      this.platform.log.debug('[' + this.config.name + '] response error: ' + String(e) + ' for ' + target);
      this.state = this.failureState;
      this.service.updateCharacteristic(
        this.getStateCharacteristic(),
        this.state,
      );
    }
  }

  private getStateCharacteristic() {
    const type = (this.config.type || 'ContactSensor').toLowerCase();
    if (type === 'contactsensor') {
      return this.platform.Characteristic.ContactSensorState;
    } else if (type === 'motionsensor') {
      return this.platform.Characteristic.MotionDetected;
    } else {
      return this.platform.Characteristic.On;
    }
  }
}
