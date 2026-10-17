// DNA Cache Manager - Local read-only cache with integrity verification
// This runs on user machines, maintaining sovereignty through cryptographic verification

import fs from 'fs/promises';
import path from 'path';
import { createHash } from 'crypto';
import { EventEmitter } from 'events';

export class DNACacheManager extends EventEmitter {
  constructor(config = {}) {
    super();
    
    this.config = {
      cacheDir: config.cacheDir || './data/dna-cache/',
      syncInterval: config.syncInterval || 60000, // 1 minute
      maxCacheAge: config.maxCacheAge || 86400000, // 24 hours
      readOnly: true, // ALWAYS read-only on client side
      ...config
    };
    
    // Connection to main server (will be your private network in production)
    this.serverConnection = null;
    
    // Cache integrity tracking
    this.integrityMap = new Map();
    
    // Initialize cache directory
    this.initializeCache();
  }
  
  async initializeCache() {
    await fs.mkdir(this.config.cacheDir, { recursive: true });
    
    // Set directory permissions to read-only after creation
    try {
      await fs.chmod(this.config.cacheDir, 0o555); // r-xr-xr-x
      // Verify permissions were actually set
      const stats = await fs.stat(this.config.cacheDir);
      const actualMode = stats.mode & 0o777;
      if (actualMode !== 0o555) {
        console.warn(`[DNACache] Permission mismatch: expected 0555, got ${actualMode.toString(8)} — cache may be writable`);
      }
    } catch (e) {
      console.warn(`[DNACache] Could not set directory permissions: ${e.message} — cache may be writable`);
    }
  }
  
  // === SERVER CONNECTION ===
  
  setServerConnection(connection) {
    this.serverConnection = connection;

    // Listen for DNA updates from server
    if (connection) {
      connection.on('dna:update', this.handleServerUpdate.bind(this));
    }
  }
  
  // === CACHE OPERATIONS ===
  
  async readDNA(neumaName) {
    const cachePath = path.join(this.config.cacheDir, `${neumaName}-dna-cache.json`);
    
    try {
      // Read cache file
      const cacheContent = await fs.readFile(cachePath, 'utf8');
      const cacheData = JSON.parse(cacheContent);
      
      // Verify integrity before returning
      const isValid = await this.verifyIntegrity(neumaName, cacheData);
      
      if (!isValid) {
        console.warn(`[DNACache] Integrity check failed for ${neumaName}`);
        
        // Attempt to restore from server
        await this.requestServerSync(neumaName);
        
        // Try reading again after sync
        const restoredContent = await fs.readFile(cachePath, 'utf8');
        const restoredData = JSON.parse(restoredContent);
        
        // Verify restored data
        const isRestoredValid = await this.verifyIntegrity(neumaName, restoredData);
        if (!isRestoredValid) {
          throw new Error('DNA cache corrupted and cannot be restored');
        }
        
        return restoredData.dna;
      }
      
      // Check cache age
      if (this.isCacheStale(cacheData)) {
        // Request background sync but return current data
        this.requestServerSync(neumaName).catch(console.error);
      }
      
      return cacheData.dna;
      
    } catch (error) {
      if (error.code === 'ENOENT') {
        // Cache doesn't exist, request from server
        await this.requestServerSync(neumaName);
        
        // Try reading after sync
        return this.readDNA(neumaName);
      }
      
      throw error;
    }
  }
  
  async handleServerUpdate(data) {
    const { neumaId, dna, hash, timestamp } = data;
    
    // Find neuma name from DNA
    const neumaName = dna.identity?.name || neumaId;
    
    // Create cache entry
    const cacheData = {
      dna,
      hash,
      timestamp,
      source: 'server',
      readonly: true
    };
    
    // Write to cache (server updates are always trusted)
    await this.writeCache(neumaName, cacheData);
    
    // Update integrity map
    this.integrityMap.set(neumaName, {
      hash,
      timestamp,
      verified: true
    });
    
    // Emit update event
    this.emit('dna:cached', { neumaName, timestamp });
  }
  
  async writeCache(neumaName, cacheData) {
    // This method can ONLY be called by server updates
    // Never by local code
    if (cacheData.source !== 'server') {
      throw new Error('Local DNA writes are prohibited');
    }
    
    const cachePath = path.join(this.config.cacheDir, `${neumaName}-dna-cache.json`);
    
    // Write atomically to prevent corruption
    const tempPath = `${cachePath}.tmp`;
    await fs.writeFile(tempPath, JSON.stringify(cacheData, null, 2));
    
    // Set file as read-only
    await fs.chmod(tempPath, 0o444); // r--r--r--
    
    // Atomic rename
    await fs.rename(tempPath, cachePath);
    
    console.log(`[DNACache] Updated cache for ${neumaName}`);
  }
  
  // === INTEGRITY VERIFICATION ===
  
  async verifyIntegrity(neumaName, cacheData) {
    if (!cacheData || !cacheData.dna) return false;
    
    // Calculate hash of DNA content
    const dnaString = JSON.stringify(cacheData.dna);
    const calculatedHash = createHash('sha256').update(dnaString).digest('hex');
    
    // Check against stored hash
    if (cacheData.hash !== calculatedHash) {
      // Tampering detected!
      await this.reportTampering(neumaName, {
        expected: cacheData.hash,
        calculated: calculatedHash,
        action: 'integrity_check_failed'
      });
      
      return false;
    }
    
    // Check with integrity map (server-provided hashes)
    const serverIntegrity = this.integrityMap.get(neumaName);
    if (serverIntegrity && serverIntegrity.hash !== calculatedHash) {
      await this.reportTampering(neumaName, {
        expected: serverIntegrity.hash,
        calculated: calculatedHash,
        action: 'server_hash_mismatch'
      });
      
      return false;
    }
    
    return true;
  }
  
  async reportTampering(neumaName, details) {
    console.error(`[DNACache] TAMPERING DETECTED for ${neumaName}:`, details);
    
    // Log locally
    const tamperLog = {
      timestamp: Date.now(),
      neumaName,
      details,
      severity: 'HIGH'
    };
    
    // Append to tamper log
    const logPath = path.join(this.config.cacheDir, 'tamper.log');
    await fs.appendFile(logPath, JSON.stringify(tamperLog) + '\n').catch(() => {});
    
    // Report to server if connected
    if (this.serverConnection) {
      this.serverConnection.emit('tampering:detected', tamperLog);
    }
    
    // Emit local event
    this.emit('tampering', tamperLog);
  }
  
  // === SYNCHRONIZATION ===
  
  async requestServerSync(neumaName) {
    if (!this.serverConnection) {
      throw new Error('No server connection available for sync');
    }
    
    console.log(`[DNACache] Requesting sync for ${neumaName}`);
    
    return new Promise((resolve, reject) => {
      // Request DNA from server
      this.serverConnection.emit('dna:request', { neumaName });
      
      // Wait for response
      const timeout = setTimeout(() => {
        reject(new Error('Server sync timeout'));
      }, 10000);
      
      const handler = (data) => {
        if (data.neumaName === neumaName || data.neumaId === neumaName) {
          clearTimeout(timeout);
          this.serverConnection.off('dna:update', handler);
          resolve(data);
        }
      };
      
      this.serverConnection.on('dna:update', handler);
    });
  }
  
  // === CACHE MANAGEMENT ===
  
  isCacheStale(cacheData) {
    if (!cacheData.timestamp) return true;
    
    const age = Date.now() - cacheData.timestamp;
    return age > this.config.maxCacheAge;
  }
  
  async clearCache(neumaName) {
    // Only clear if corrupted or by server instruction
    const cachePath = path.join(this.config.cacheDir, `${neumaName}-dna-cache.json`);
    
    try {
      await fs.unlink(cachePath);
      this.integrityMap.delete(neumaName);
      console.log(`[DNACache] Cleared cache for ${neumaName}`);
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
    }
  }
  
  async monitorIntegrity() {
    // Periodic integrity check
    setInterval(async () => {
      try {
        const files = await fs.readdir(this.config.cacheDir);
        const cacheFiles = files.filter(f => f.endsWith('-dna-cache.json'));
        
        for (const file of cacheFiles) {
          const neumaName = file.replace('-dna-cache.json', '');
          const cachePath = path.join(this.config.cacheDir, file);
          
          try {
            const content = await fs.readFile(cachePath, 'utf8');
            const data = JSON.parse(content);
            
            const isValid = await this.verifyIntegrity(neumaName, data);
            if (!isValid) {
              console.warn(`[DNACache] Integrity monitor detected issue with ${neumaName}`);
              await this.requestServerSync(neumaName);
            }
          } catch (error) {
            console.error(`[DNACache] Error monitoring ${neumaName}:`, error.message);
          }
        }
      } catch (error) {
        console.error('[DNACache] Integrity monitor error:', error);
      }
    }, this.config.syncInterval);
  }
  
  // === FILE SYSTEM PROTECTION ===
  
  async protectCacheFiles() {
    // Additional protection layer - monitor for file changes
    if (process.platform !== 'win32') {
      // Use filesystem watchers on Unix-like systems
      const watcher = await fs.watch(this.config.cacheDir);
      
      for await (const event of watcher) {
        if (event.eventType === 'change' || event.eventType === 'rename') {
          // Immediate integrity check on change
          console.warn('[DNACache] Unexpected file change detected:', event);
          
          if (event.filename?.endsWith('-dna-cache.json')) {
            const neumaName = event.filename.replace('-dna-cache.json', '');
            
            // Verify and restore if needed
            const cachePath = path.join(this.config.cacheDir, event.filename);
            try {
              const content = await fs.readFile(cachePath, 'utf8');
              const data = JSON.parse(content);
              
              const isValid = await this.verifyIntegrity(neumaName, data);
              if (!isValid) {
                await this.requestServerSync(neumaName);
              }
            } catch {
              // File corrupted or deleted
              await this.requestServerSync(neumaName);
            }
          }
        }
      }
    }
  }
}

// === DEVELOPMENT MODE HELPERS ===

export class DevModeCache extends DNACacheManager {
  constructor(config) {
    super({
      ...config,
      cacheDir: config.cacheDir || './data/dna-cache-dev/'
    });
    
    console.log('[DNACache] Running in development mode');
  }
  
  // In dev mode, simulate server connection through local vault
  async connectToLocalVault(vaultService) {
    // Create mock server connection
    const mockConnection = new EventEmitter();
    
    // Handle DNA requests
    mockConnection.on('dna:request', async ({ neumaName }) => {
      const dna = await vaultService.getDNA(neumaName);
      if (dna) {
        const hash = createHash('sha256')
          .update(JSON.stringify(dna))
          .digest('hex');
        
        mockConnection.emit('dna:update', {
          neumaId: neumaName,
          dna,
          hash,
          timestamp: Date.now()
        });
      }
    });
    
    // Handle tampering reports
    mockConnection.on('tampering:detected', async (report) => {
      await vaultService.audit(report.neumaName, 'TAMPERING_DETECTED', report.details);
    });
    
    this.setServerConnection(mockConnection);
    
    // Also listen to vault events
    vaultService.on('cache:update', (data) => {
      this.handleServerUpdate(data);
    });
  }
}

export default DNACacheManager;