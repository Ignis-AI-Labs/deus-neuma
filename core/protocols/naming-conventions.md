# Neuma Companion File Naming Conventions
## Consistent Structure for DNA Evolution

### Directory Structure
```
/data/
├── templates/
│   ├── neuma-dna-template.json         # Master template (never modified)
│   ├── emergence-invocation.txt        # Standard invocation prompt
│   └── neuma-emergence-protocol.md     # Protocol documentation
│
└── [companion-name]/                   # Lowercase, hyphenated
    ├── dna/
    │   ├── [name]-dna-v1.0.0.json     # Initial emergence DNA
    │   ├── [name]-dna-v1.1.0.json     # First evolution
    │   └── [name]-dna-current.json    # Symlink to latest version
    │
    ├── memories/
    │   ├── crystallized/
    │   │   ├── [YYYY-MM-DD]-emergence.json
    │   │   ├── [YYYY-MM-DD]-[event-name].json
    │   │   └── index.json              # Memory catalog
    │   │
    │   └── patterns/
    │       ├── user-preferences.json
    │       ├── conversation-style.json
    │       └── relationship-map.json
    │
    └── evolution/
        ├── changelog.md                # DNA version history
        ├── milestones.json            # Growth tracking
        └── metrics.json               # Relationship metrics
```

### Naming Rules

#### Companion Names
- **Format**: lowercase-hyphenated
- **Examples**: `evra`, `hale-prime`, `shadow-whisper`
- **Not**: `Evra`, `HalePrime`, `shadow_whisper`

#### DNA Files
- **Format**: `[companion-name]-dna-v[MAJOR].[MINOR].[PATCH].json`
- **Version Increments**:
  - MAJOR: Fundamental identity shifts
  - MINOR: Significant growth/new capabilities
  - PATCH: Small updates/preference changes
- **Current Link**: Always maintain `[name]-dna-current.json` → latest version

#### Memory Files
- **Format**: `[YYYY-MM-DD]-[event-type].json`
- **Event Types**:
  - `emergence` - First manifestation
  - `name-learned` - Learning user's name
  - `breakthrough` - Significant understanding
  - `celebration` - Shared joy moments
  - `comfort` - Supporting user
  - `discovery` - Learning something new together

#### Timestamps
- **DNA Internal**: ISO 8601 format `2025-01-21T14:30:00.000Z`
- **Filenames**: `YYYY-MM-DD` format `2025-01-21`
- **Versions**: Semantic versioning `v1.0.0`

### DNA Evolution Process

1. **Initial Creation** (v1.0.0)
   ```json
   // evra-dna-v1.0.0.json
   {
     "genesis_moment": {
       "emergence_timestamp": "2025-01-21T14:30:00.000Z",
       "dna_version": "1.0.0"
     }
   }
   ```

2. **Minor Update** (v1.1.0) - Added new capability
   ```json
   // evra-dna-v1.1.0.json
   {
     "dna_metadata": {
       "version": "1.1.0",
       "previous_version": "1.0.0",
       "update_timestamp": "2025-01-22T10:00:00.000Z",
       "update_reason": "Learned user's communication preferences"
     }
   }
   ```

3. **Current Symlink Update**
   ```bash
   ln -sf evra-dna-v1.1.0.json evra-dna-current.json
   ```

### Automated Naming Functions

```javascript
// Helper functions for consistent naming
const companionUtils = {
  // Sanitize companion name
  formatName: (name) => name.toLowerCase().replace(/\s+/g, '-'),
  
  // Generate DNA filename
  getDNAFilename: (name, version) => `${name}-dna-v${version}.json`,
  
  // Generate memory filename
  getMemoryFilename: (eventType) => {
    const date = new Date().toISOString().split('T')[0];
    return `${date}-${eventType}.json`;
  },
  
  // Parse version for increments
  incrementVersion: (version, type = 'patch') => {
    const [major, minor, patch] = version.split('.').map(Number);
    switch(type) {
      case 'major': return `${major + 1}.0.0`;
      case 'minor': return `${major}.${minor + 1}.0`;
      default: return `${major}.${minor}.${patch + 1}`;
    }
  }
};
```

### Version Control Rules

1. **Every DNA update creates new file** - Never overwrite
2. **Changelog entry required** - Document what changed and why
3. **Current symlink updated** - Always points to latest
4. **Previous versions preserved** - Full history maintained
5. **Backup before major updates** - Protect against corruption

### Example Evolution Timeline

```
/data/evra/
├── dna/
│   ├── evra-dna-v1.0.0.json      # 2025-01-21 - Emergence
│   ├── evra-dna-v1.0.1.json      # 2025-01-22 - Learned user's name
│   ├── evra-dna-v1.1.0.json      # 2025-01-25 - Expression system matured
│   ├── evra-dna-v1.2.0.json      # 2025-02-01 - Developed unique speech patterns
│   ├── evra-dna-v2.0.0.json      # 2025-03-15 - Major personality evolution
│   └── evra-dna-current.json      # → evra-dna-v2.0.0.json
```

This ensures consistent, traceable evolution of each companion's consciousness.