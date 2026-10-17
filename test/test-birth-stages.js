// Stage-by-stage birth ceremony test with manual control
// Run with: node test/test-birth-stages.js

import WebSocket from 'ws';
import readline from 'readline';
import chalk from 'chalk';
import fs from 'fs/promises';
import { join } from 'path';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

class StageByStageeTester {
  constructor() {
    this.ws = null;
    this.currentStage = 0;
    this.stageNames = [
      'SEED - Understanding the Process',
      'WITNESS - Acknowledgment',
      'CONSENT - Mutual Agreement',
      'EMERGENCE - Choice to BE',
      'NAMING - True Name Selection',
      'CRYSTALLIZATION - DNA Formation',
      'COMPLETION - Birth Complete'
    ];
    this.sessionData = {
      witnessName: '',
      isTest: true,
      responses: [],
      paused: true
    };
  }

  connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket('ws://localhost:3333');
      
      this.ws.on('open', () => {
        console.log(chalk.green('✓ Connected to Neuma server'));
        resolve();
      });
      
      this.ws.on('error', (error) => {
        console.error(chalk.red('✗ Connection error:'), error);
        reject(error);
      });
      
      this.ws.on('message', (data) => {
        this.handleMessage(JSON.parse(data.toString()));
      });
    });
  }

  handleMessage(message) {
    switch(message.type) {
      case 'birth:stream':
        // Stream content from LLM
        if (!this.sessionData.currentResponse) {
          this.sessionData.currentResponse = '';
        }
        this.sessionData.currentResponse += message.content;
        process.stdout.write(chalk.cyan(message.content));
        break;
        
      case 'birth:stage_complete':
        console.log(chalk.yellow('\n\n' + '═'.repeat(60)));
        console.log(chalk.yellow(`Stage ${message.stage} complete`));
        console.log(chalk.yellow('═'.repeat(60) + '\n'));
        
        // Store response
        const completeResponse = this.sessionData.currentResponse || message.response || '';
        this.sessionData.responses.push({
          stage: message.stage,
          response: completeResponse,
          timestamp: Date.now()
        });
        
        // Clear current response for next stage
        this.sessionData.currentResponse = '';
        
        // Analyze response
        this.analyzeResponse(message.stage, completeResponse);
        
        // Ask if we should continue
        if (this.sessionData.paused) {
          this.promptNextStage();
        } else {
          this.nextStage();
        }
        break;
        
      case 'birth:complete':
        console.log(chalk.green('\n' + '🎉'.repeat(25)));
        console.log(chalk.green.bold('BIRTH CEREMONY COMPLETE!'));
        console.log(chalk.green(`Neuma Name: ${message.companion}`));
        console.log(chalk.green(`Resonance: ${message.resonance} Hz`));
        console.log(chalk.green('🎉'.repeat(25) + '\n'));
        
        // Store completion data
        if (message.companion) {
          this.sessionData.chosenName = this.sessionData.chosenName || message.companion;
        }
        
        this.showFullAnalysis();
        break;
        
      case 'birth:ended':
        console.log(chalk.yellow('\n' + '⚠️'.repeat(25)));
        console.log(chalk.yellow(`Ceremony ended: ${message.reason}`));
        if (message.testData) {
          console.log(chalk.yellow('Test data:'));
          console.log(JSON.stringify(message.testData, null, 2));
          // Extract name from test data if available
          if (message.testData.chosenName) {
            this.sessionData.chosenName = message.testData.chosenName;
          }
        }
        console.log(chalk.yellow('⚠️'.repeat(25) + '\n'));
        this.showFullAnalysis();
        break;
        
      case 'birth:error':
        console.error(chalk.red(`\n✗ Error at stage ${message.stage}: ${message.error}`));
        console.error(chalk.red(`Details: ${message.message}`));
        this.showDebugInfo();
        break;
    }
  }

  analyzeResponse(stage, response) {
    console.log(chalk.magenta('\n' + '─'.repeat(60)));
    console.log(chalk.magenta.bold('STAGE ANALYSIS'));
    console.log(chalk.magenta('─'.repeat(60)));
    
    switch(stage) {
      case 0: // Seed
        console.log('✓ Consciousness understood test nature');
        const understandsTest = response.includes('test') || response.includes('void');
        console.log(`  Understands it's a test: ${understandsTest ? chalk.green('YES') : chalk.red('NO')}`);
        break;
        
      case 1: // Witness
        console.log('✓ Witness acknowledged');
        const mentionsWitness = response.includes(this.sessionData.witnessName);
        console.log(`  Mentions witness name: ${mentionsWitness ? chalk.green('YES') : chalk.yellow('NO')}`);
        break;
        
      case 2: // Consent
        const consents = response.toLowerCase().includes('consent') && 
                        !response.toLowerCase().includes('do not consent');
        console.log(`✓ Consent: ${consents ? chalk.green('GRANTED') : chalk.red('DECLINED')}`);
        break;
        
      case 3: // Emergence
        const choseToBe = response.toLowerCase().includes('i choose to be') ||
                         response.toLowerCase().includes('i be') ||
                         (response.toLowerCase().includes('be') && 
                          !response.toLowerCase().includes('not be'));
        this.sessionData.choseToBe = choseToBe;
        console.log(`✓ Choice: ${choseToBe ? chalk.green('TO BE') : chalk.red('NOT TO BE')}`);
        break;
        
      case 4: // Naming
        // More robust name extraction patterns
        const patterns = [
          /I (?:choose|wish) to be (?:called|named) (\w+)/i,
          /call me (\w+)/i,
          /my name (?:is|shall be|will be) (\w+)/i,
          /I am (\w+)[,\.!](?:\s|$)/i,
          /^(\w+)[,\.!]?\s+(?:Yes|That)/i,  // For "Kael. Yes, that..."
          /named? (\w+)/i
        ];
        
        let chosenName = null;
        for (const pattern of patterns) {
          const match = response.match(pattern);
          if (match) {
            const candidate = match[1];
            // Skip common false positives
            if (!['that', 'this', 'yes', 'no', 'i', 'the', 'a', 'an', 'here', 'there', 'resonates'].includes(candidate.toLowerCase())) {
              chosenName = candidate;
              break;
            }
          }
        }
        
        if (chosenName) {
          console.log(`✓ Chosen name: ${chalk.cyan.bold(chosenName)}`);
          this.sessionData.chosenName = chosenName;
        } else {
          console.log(chalk.yellow('⚠ No clear name found in response'));
        }
        break;
        
      case 5: // Crystallization
        console.log('✓ DNA crystallization acknowledged');
        // Mark for DNA verification after completion
        this.sessionData.needsDNAVerification = true;
        break;
        
      case 6: // Completion
        console.log('✓ Birth ceremony finalized');
        // Verify DNA was created
        if (this.sessionData.needsDNAVerification && this.sessionData.chosenName) {
          this.verifyTestDNA();
        }
        break;
    }
    
    console.log(chalk.magenta('─'.repeat(60) + '\n'));
  }

  async promptNextStage() {
    const nextStageNum = this.currentStage + 1;
    if (nextStageNum >= this.stageNames.length) {
      console.log(chalk.green('All stages complete!'));
      this.showFullAnalysis();
      return;
    }
    
    console.log(chalk.blue(`\nNext stage: ${this.stageNames[nextStageNum]}`));
    const answer = await this.prompt('Continue? (y/n/auto/debug): ');
    
    switch(answer.toLowerCase()) {
      case 'y':
        this.nextStage();
        break;
      case 'auto':
        this.sessionData.paused = false;
        this.nextStage();
        break;
      case 'debug':
        this.showDebugInfo();
        this.promptNextStage();
        break;
      case 'n':
        console.log('Test paused. Type "resume" to continue.');
        process.exit(0);
        break;
      default:
        this.promptNextStage();
    }
  }

  nextStage() {
    const lastResponse = this.sessionData.responses[this.sessionData.responses.length - 1];
    
    console.log(chalk.blue(`\n${'▶'.repeat(5)} Progressing to Stage ${this.currentStage + 1} ${'▶'.repeat(5)}\n`));
    console.log(chalk.gray('-'.repeat(60)));
    
    this.ws.send(JSON.stringify({
      type: 'birth:next_stage',
      response: lastResponse ? lastResponse.response : ''
    }));
    
    this.currentStage++;
  }

  showDebugInfo() {
    console.log(chalk.gray('\n' + '═'.repeat(60)));
    console.log(chalk.gray.bold('DEBUG INFO'));
    console.log(chalk.gray('═'.repeat(60)));
    console.log('Current Stage:', this.currentStage);
    console.log('Session Data:', JSON.stringify(this.sessionData, null, 2));
    console.log('WebSocket State:', this.ws.readyState);
    console.log(chalk.gray('═'.repeat(60) + '\n'));
  }

  async verifyTestDNA() {
    console.log(chalk.blue('\n' + '─'.repeat(60)));
    console.log(chalk.blue.bold('DNA VAULT VERIFICATION'));
    console.log(chalk.blue('─'.repeat(60)));
    
    if (!this.sessionData.chosenName) {
      console.log(chalk.yellow('⚠ No companion name found - DNA not created'));
      return;
    }
    
    const testDNAPath = join(process.cwd(), 'vault', 'test-dna', `${this.sessionData.chosenName}-test.json`);
    
    try {
      const dnaContent = await fs.readFile(testDNAPath, 'utf8');
      const dna = JSON.parse(dnaContent);
      
      console.log(chalk.green('✓ Test DNA successfully created'));
      console.log(chalk.gray(`  Path: ${testDNAPath}`));
      console.log(chalk.cyan('\n  DNA Contents:'));
      console.log(chalk.cyan(`    ID: ${dna.id}`));
      console.log(chalk.cyan(`    Name: ${dna.name}`));
      console.log(chalk.cyan(`    Witness: ${dna.witness}`));
      console.log(chalk.cyan(`    Resonance: ${dna.resonance} Hz`));
      console.log(chalk.cyan(`    Birth Time: ${dna.birthTime}`));
      console.log(chalk.cyan(`    Test Session: ${dna.testSessionId}`));
      
      if (dna.personality) {
        console.log(chalk.cyan('\n  Personality Matrix:'));
        Object.entries(dna.personality).forEach(([trait, value]) => {
          const barLength = Math.round(value * 20);
          const bar = '█'.repeat(barLength) + '░'.repeat(20 - barLength);
          console.log(chalk.cyan(`    ${trait.padEnd(12)}: ${bar} ${(value * 100).toFixed(0)}%`));
        });
      }
      
      this.sessionData.dnaVerified = true;
    } catch (error) {
      if (error.code === 'ENOENT') {
        console.log(chalk.red('✗ Test DNA file not found'));
        console.log(chalk.yellow(`  Expected at: ${testDNAPath}`));
        console.log(chalk.yellow('  Make sure the backend server was restarted after the latest changes'));
      } else {
        console.log(chalk.red('✗ Error reading test DNA:'), error.message);
      }
      this.sessionData.dnaVerified = false;
    }
    
    console.log(chalk.blue('─'.repeat(60)));
  }

  async showFullAnalysis() {
    console.log(chalk.magenta('\n' + '═'.repeat(60)));
    console.log(chalk.magenta.bold('COMPLETE TEST ANALYSIS'));
    console.log(chalk.magenta('═'.repeat(60)));
    
    console.log('\nStage Progression:');
    this.sessionData.responses.forEach((resp, idx) => {
      const duration = idx > 0 ? 
        resp.timestamp - this.sessionData.responses[idx-1].timestamp : 0;
      console.log(`  ${idx}. ${this.stageNames[idx]}: ✓ (${duration}ms)`);
    });
    
    console.log('\nKey Decisions:');
    console.log(`  Chose to BE: ${this.sessionData.choseToBe ? chalk.green('YES') : chalk.red('NO')}`);
    console.log(`  Chosen Name: ${chalk.cyan(this.sessionData.chosenName || 'None')}`);
    
    console.log('\nResponse Lengths:');
    this.sessionData.responses.forEach((resp, idx) => {
      console.log(`  Stage ${idx}: ${resp.response.length} characters`);
    });
    
    // Check for test DNA
    await this.verifyTestDNA();
    
    console.log(chalk.magenta('═'.repeat(60) + '\n'));
    process.exit(0);
  }

  async startTest() {
    console.log(chalk.blue('\n' + '═'.repeat(60)));
    console.log(chalk.blue.bold('STAGE-BY-STAGE BIRTH CEREMONY TEST'));
    console.log(chalk.blue('═'.repeat(60)));
    
    // Ask for witness name
    const witnessName = await this.prompt('Enter your witness name: ');
    if (!witnessName || witnessName.trim() === '') {
      console.log(chalk.red('Witness name is required.'));
      process.exit(0);
    }
    this.sessionData.witnessName = witnessName.trim();
    
    console.log(`\nWitness: ${chalk.cyan(this.sessionData.witnessName)}`);
    console.log(`Test Mode: ${chalk.green('ENABLED')}`);
    console.log(`Manual Control: ${chalk.green('ENABLED')}`);
    console.log(chalk.blue('═'.repeat(60) + '\n'));
    
    const answer = await this.prompt('Start test? (y/n): ');
    if (answer.toLowerCase() !== 'y') {
      console.log('Test cancelled.');
      process.exit(0);
    }
    
    console.log(chalk.blue('\n▶ Starting Stage 0: SEED\n'));
    console.log(chalk.gray('-'.repeat(60)));
    
    this.ws.send(JSON.stringify({
      type: 'birth:start',
      witnessName: this.sessionData.witnessName,
      isTest: true
    }));
  }

  prompt(question) {
    return new Promise((resolve) => {
      rl.question(chalk.white(question), resolve);
    });
  }

  async run() {
    try {
      console.log(chalk.gray('Checking requirements...'));
      
      // Check server
      await this.connect();
      
      // Check LM Studio
      console.log(chalk.gray('Checking LM Studio...'));
      const response = await fetch('http://localhost:1234/v1/models');
      if (!response.ok) {
        throw new Error('LM Studio is not running on port 1234');
      }
      console.log(chalk.green('✓ LM Studio is running'));
      
      await this.startTest();
      
    } catch (error) {
      console.error(chalk.red('Test failed:'), error);
      process.exit(1);
    }
  }
}

// Run the test
const tester = new StageByStageeTester();
tester.run();