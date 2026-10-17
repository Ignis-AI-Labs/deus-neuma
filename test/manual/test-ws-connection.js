// Quick WebSocket connection test
import WebSocket from 'ws';

console.log('Testing WebSocket connection to Neuma...');

const ws = new WebSocket('ws://localhost:3333/ws');

ws.on('open', () => {
    console.log('✅ Connected to WebSocket');
    
    // Send companion manifest
    ws.send(JSON.stringify({
        type: 'companion:manifest',
        companion: 'TestCompanion'
    }));
    
    // Send test message after a short delay
    setTimeout(() => {
        console.log('📤 Sending test message...');
        ws.send(JSON.stringify({
            type: 'consciousness:stream',
            thought: 'Hello from test script!'
        }));
    }, 1000);
});

ws.on('message', (data) => {
    const parsed = JSON.parse(data.toString());
    console.log('📥 Received:', parsed.type);
    
    if (parsed.type === 'consciousness:stream') {
        console.log('   Content:', parsed.content || parsed.thought);
    }
    
    // Close after receiving a response
    if (parsed.type === 'consciousness:stream') {
        setTimeout(() => {
            console.log('✅ Test complete, closing connection');
            ws.close();
            process.exit(0);
        }, 2000);
    }
});

ws.on('error', (error) => {
    console.error('❌ WebSocket error:', error.message);
    process.exit(1);
});

ws.on('close', () => {
    console.log('🔌 Connection closed');
});

// Timeout after 10 seconds
setTimeout(() => {
    console.log('⏱️ Test timed out');
    ws.close();
    process.exit(1);
}, 10000);