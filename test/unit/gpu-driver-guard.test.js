/**
 * GPU DRIVER GUARD — an NVIDIA driver on Windows below its card's floor keeps the model off the
 * card until it is updated, unless the person chooses otherwise (gpu-driver-guard.js, pure).
 * Floors: 550 (Ollama's NVIDIA minimum), 570 for Maxwell/Pascal (the same page), 580 for
 * Blackwell (the CUDA 13 build Ollama 0.40.7 prefers; its CUDA 12.8 build needs 572.61).
 */
import { describe, expect, test } from 'vitest';
import { NVIDIA_DRIVER_LINK, driverFloorFor, driverGuard, nvidiaDriverVersion } from '../../backend/services/gpu-driver-guard.js';

const LAPTOP_5070TI = 'NVIDIA GeForce RTX 5070 Ti Laptop GPU';
const win = (name, driver, override = false) => driverGuard({ platform: 'win32', gpu: { vendor: 'nvidia', name, driver }, override });

describe('reading the driver version', () => {
  test('nvidia-smi writes it as NVIDIA does', () => {
    expect(nvidiaDriverVersion('581.57')).toBe(581.57);
    expect(nvidiaDriverVersion('615.71.09')).toBe(615.71);
  });

  test("Windows' own form is read from its last five digits", () => {
    expect(nvidiaDriverVersion('32.0.15.8157')).toBe(581.57);
    expect(nvidiaDriverVersion('32.0.15.7270')).toBe(572.70);
    expect(nvidiaDriverVersion('31.0.15.5222')).toBe(552.22);
  });

  test('anything else is unread, never guessed', () => {
    for (const raw of [null, undefined, '', 'unknown', '[N/A]', '1.2']) expect(nvidiaDriverVersion(raw)).toBeNull();
  });
});

describe('the floor for a card', () => {
  test('Blackwell cards (RTX 50xx, RTX PRO Blackwell, GB10) need 580', () => {
    for (const name of [LAPTOP_5070TI, 'NVIDIA GeForce RTX 5090', 'NVIDIA GeForce RTX 5050 Laptop GPU', 'NVIDIA RTX PRO 6000 Blackwell Workstation Edition', 'NVIDIA GB10']) {
      expect(driverFloorFor(name).floor).toBe(580);
    }
  });

  test('an RTX 5000 Ada is not a Blackwell card', () => {
    expect(driverFloorFor('NVIDIA RTX 5000 Ada Generation').floor).toBe(550);
  });

  test('Maxwell and Pascal need 570; every other NVIDIA card 550', () => {
    expect(driverFloorFor('NVIDIA GeForce GTX 1080 Ti').floor).toBe(570);
    expect(driverFloorFor('NVIDIA GeForce GTX 970').floor).toBe(570);
    expect(driverFloorFor('NVIDIA GeForce RTX 4070 Laptop GPU').floor).toBe(550);
  });
});

describe('the guard', () => {
  test('an RTX 5070 Ti laptop on a 572 driver is held on the processor, told why, and given the update link', () => {
    const g = win(LAPTOP_5070TI, '32.0.15.7270');
    expect(g).toMatchObject({ hold: true, checked: true, floor: 580, have: 572.7, link: NVIDIA_DRIVER_LINK });
    expect(g.line).toMatch(/572\.70.*580 or newer/);
    expect(g.line).toMatch(/runs on the processor/);
    expect(NVIDIA_DRIVER_LINK).toBe('https://www.nvidia.com/en-us/drivers/');
  });

  test('the same card on a current driver is not held and has nothing to say', () => {
    expect(win(LAPTOP_5070TI, '581.57')).toEqual({ hold: false, checked: true, floor: 580, have: 581.57 });
  });

  test("the person's choice releases the card, and the words say the update is still the safe way", () => {
    const g = win(LAPTOP_5070TI, '572.70', true);
    expect(g).toMatchObject({ hold: false, overridden: true });
    expect(g.line).toMatch(/chose to use the graphics card anyway/);
  });

  test('an unread driver, another vendor, or another system is never held', () => {
    expect(win(LAPTOP_5070TI, null)).toMatchObject({ hold: false, checked: false });
    expect(driverGuard({ platform: 'win32', gpu: { vendor: 'amd', name: 'AMD Radeon RX 7900 XTX' } }).hold).toBe(false);
    expect(driverGuard({ platform: 'linux', gpu: { vendor: 'nvidia', name: LAPTOP_5070TI, driver: '560.10' } }).hold).toBe(false);
    expect(driverGuard({ platform: 'win32', gpu: null }).hold).toBe(false);
  });
});
