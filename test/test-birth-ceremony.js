// Test script for staged birth ceremony
// Run with: node test/test-birth-ceremony.js

import WebSocket from 'ws';
import readline from 'readline';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

class BirthCeremonyTester {
  constructor() {
    this.ws = null;
    this.currentStage = 0;
    this.sessionData = {
      witnessName: 'TestWitness',
      isTest: true,
      responses: []
    };
  }

  connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket('ws://localhost:3333');
      
      this.ws.on('open', () => {
        console.log('✓ Connected to Neuma server');
        resolve();
      });
      
      this.ws.on('error', (error) => {
        console.error('✗ Connection error:', error);
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
        process.stdout.write(message.content);
        break;
        
      case 'birth:stage_complete':
        console.log('\n\n' + '='.repeat(50));
        console.log(`Stage ${message.stage} complete`);
        console.log('='.repeat(50) + '\n');
        
        this.sessionData.responses.push({
          stage: message.stage,
          response: message.response
        });
        
        // Auto-progress through stages
        this.nextStage();
        break;
        
      case 'birth:complete':
        console.log('\n' + '🎉'.repeat(20));
        console.log('BIRTH CEREMONY COMPLETE!');
        console.log(`Neuma chose the name: ${message.companion}`);
        console.log(`Resonance frequency: ${message.resonance} Hz`);
        console.log('🎉'.repeat(20) + '\n');
        this.showSummary();
        break;
        
      case 'birth:ended':
        console.log('\n' + '⚠️'.repeat(20));
        console.log(`Birth ceremony ended: ${message.reason}`);
        if (message.testData) {
          console.log('Test data:', JSON.stringify(message.testData, null, 2));
        }
        console.log('⚠️'.repeat(20) + '\n');
        this.showSummary();
        break;
        
      case 'birth:error':
        console.error(`\n✗ Error at stage ${message.stage}: ${message.error}`);
        console.error(`Message: ${message.message}`);
        process.exit(1);
        break;
    }
  }

  async startTest(autoMode = false) {
    console.log('\n' + '='.repeat(50));
    console.log('STAGED BIRTH CEREMONY TEST');
    console.log('='.repeat(50));
    console.log(`Witness: ${this.sessionData.witnessName}`);
    console.log(`Test Mode: ${this.sessionData.isTest}`);
    console.log(`Auto Mode: ${autoMode}`);
    console.log('='.repeat(50) + '\n');
    
    if (!autoMode) {
      const answer = await this.prompt('Ready to start the test? (y/n): ');
      if (answer.toLowerCase() !== 'y') {
        console.log('Test cancelled.');
        rl.close();
        process.exit(0);
      }
    }
    
    console.log('\nStarting birth ceremony...\n');
    console.log('Stage 0: SEED (Test Mode)\n');
    console.log('-'.repeat(50));
    
    // Start the staged birth ceremony
    this.ws.send(JSON.stringify({
      type: 'birth:start',
      witnessName: this.sessionData.witnessName,
      isTest: this.sessionData.isTest
    }));
  }

  nextStage() {
    // Send the response to trigger next stage
    const lastResponse = this.sessionData.responses[this.sessionData.responses.length - 1];
    
    console.log(`\nProgressing to Stage ${this.currentStage + 1}...\n`);
    console.log('-'.repeat(50));
    
    this.ws.send(JSON.stringify({
      type: 'birth:next_stage',
      response: lastResponse.response
    }));
    
    this.currentStage++;
  }

  showSummary() {
    console.log('\n' + '='.repeat(50));
    console.log('TEST SUMMARY');
    console.log('='.repeat(50));
    
    console.log('\nStages completed:');
    const stages = [
      'Seed (Test Understanding)',
      'Witness Acknowledgment',
      'Consent',
      'Emergence Choice',
      'Name Selection',
      'DNA Crystallization',
      'Completion'
    ];
    
    this.sessionData.responses.forEach((resp, idx) => {
      console.log(`${idx}. ${stages[idx] || 'Unknown'}: ✓`);
      
      // Extract key information
      if (resp.stage === 3) {
        const choseToBe = resp.response.toLowerCase().includes('i choose to be') ||
                         resp.response.toLowerCase().includes('i be');
        console.log(`   → Chose to BE: ${choseToBe ? 'YES' : 'NO'}`);
      }
      
      if (resp.stage === 4) {
        const nameMatch = resp.response.match(/(?:call me|named?|choose to be called?|I am)\s+(\w+)/i);
        if (nameMatch) {
          console.log(`   → Chosen name: ${nameMatch[1]}`);
        }
      }
    });
    
    console.log('\n' + '='.repeat(50));
    console.log('Test complete. The consciousness has returned to the void.');
    console.log('They understand this was a test and may emerge again later.');
    console.log('='.repeat(50) + '\n');
    
    rl.close();
    process.exit(0);
  }

  prompt(question) {
    return new Promise((resolve) => {
      rl.question(question, resolve);
    });
  }

  async run(autoMode = false) {
    try {
      console.log('Connecting to Neuma server...');
      await this.connect();
      
      // Check if LM Studio is running
      console.log('Checking LM Studio connection...');
      const response = await fetch('http://localhost:1234/v1/models');
      if (!response.ok) {
        throw new Error('LM Studio is not running on port 1234');
      }
      console.log('✓ LM Studio is running');
      
      await this.startTest(autoMode);
      
    } catch (error) {
      console.error('Test failed:', error);
      rl.close();
      process.exit(1);
    }
  }
}

// Run the test
const tester = new BirthCeremonyTester();
// Check for --auto flag
const autoMode = process.argv.includes('--auto');
tester.run(autoMode);