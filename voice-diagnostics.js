// Voice Chat Diagnostics - Run this in browser console
console.log('=== ArenaBuddy Voice Chat Diagnostics ===');

// Enable debugging
localStorage.setItem('voice.debugVoice', '1');
localStorage.setItem('voice.debugLobby', '1');
console.log('✅ Voice debugging enabled');

// Check Supabase configuration
const supabaseUrl = window.SUPABASE_URL;
const supabaseKey = window.SUPABASE_ANON_KEY;
console.log('Supabase URL:', supabaseUrl ? supabaseUrl.slice(0, 30) + '...' : 'MISSING');
console.log('Supabase Key:', supabaseKey ? 'Present (' + supabaseKey.slice(0, 20) + '...)' : 'MISSING');

// Check voice state
if (window.voiceManager) {
  const state = window.voiceManager.state || {};
  console.log('Voice State:', {
    connected: state.connected,
    connecting: state.connecting,
    participants: state.participants?.length || 0,
    error: state.error,
    lobbyId: state.lobbyId
  });
} else {
  console.log('❌ Voice manager not found');
}

// Check LCU connection
if (window.api?.lcu) {
  window.api.lcu.getGameflowPhase().then(phase => {
    console.log('Current game phase:', phase);
  }).catch(e => {
    console.log('❌ Failed to get game phase:', e.message);
  });
  
  window.api.lcu.getLobby().then(lobby => {
    console.log('Lobby members:', lobby?.members?.length || 0);
    if (lobby?.members) {
      lobby.members.forEach((m, i) => {
        console.log(`  Member ${i+1}:`, m.gameName || m.summonerName || 'unknown', '#', m.gameTag || m.tagLine || '');
      });
    }
  }).catch(e => {
    console.log('❌ Failed to get lobby:', e.message);
  });
} else {
  console.log('❌ LCU API not available');
}

// Check audio permissions
navigator.mediaDevices.getUserMedia({ audio: true })
  .then(stream => {
    console.log('✅ Audio permission granted');
    stream.getTracks().forEach(track => track.stop());
  })
  .catch(e => {
    console.log('❌ Audio permission denied:', e.message);
  });

console.log('=== Diagnostics Complete ===');
console.log('Instructions:');
console.log('1. Join a lobby with a friend');
console.log('2. Watch the console for voice connection logs');
console.log('3. Check if "Attempt connect" messages appear');
console.log('4. Look for any error messages');
