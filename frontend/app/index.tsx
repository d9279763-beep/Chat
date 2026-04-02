import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Animated,
  Keyboard,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Audio } from 'expo-av';
import { useRouter } from 'expo-router';

const BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL;

interface Message {
  id: string;
  role: 'user' | 'jarvis';
  content: string;
  timestamp: Date;
  searchedWeb?: boolean;
  learnedInfo?: { key: string; value: string } | null;
  knowledgeUsed?: number;
  audioBase64?: string;
}

export default function JarvisScreen() {
  const router = useRouter();
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [searchEnabled, setSearchEnabled] = useState(false);
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [transcript, setTranscript] = useState('');
  const [currentSound, setCurrentSound] = useState<Audio.Sound | null>(null);
  const scrollViewRef = useRef<ScrollView>(null);
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const glowAnim = useRef(new Animated.Value(0.3)).current;
  const micPulse = useRef(new Animated.Value(1)).current;

  // Initialize with a greeting
  useEffect(() => {
    const greeting: Message = {
      id: '1',
      role: 'jarvis',
      content: "Good day, Sir. I am JARVIS, your personal AI assistant. I continuously learn from our conversations and grow smarter every day. How may I be of service?",
      timestamp: new Date(),
    };
    setMessages([greeting]);
    
    // Play greeting with HD voice
    playHighQualityVoice(greeting.content);
    
    // Setup audio
    setupAudio();
    
    // Start glow animation
    Animated.loop(
      Animated.sequence([
        Animated.timing(glowAnim, {
          toValue: 0.8,
          duration: 2000,
          useNativeDriver: true,
        }),
        Animated.timing(glowAnim, {
          toValue: 0.3,
          duration: 2000,
          useNativeDriver: true,
        }),
      ])
    ).start();
    
    return () => {
      if (currentSound) {
        currentSound.unloadAsync();
      }
    };
  }, []);

  const setupAudio = async () => {
    try {
      await Audio.setAudioModeAsync({
        playsInSilentModeIOS: true,
        staysActiveInBackground: false,
        shouldDuckAndroid: true,
      });
    } catch (error) {
      console.error('Audio setup error:', error);
    }
  };

  // Pulse animation when loading
  useEffect(() => {
    if (isLoading) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 1.2,
            duration: 500,
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: 500,
            useNativeDriver: true,
          }),
        ])
      ).start();
    } else {
      pulseAnim.setValue(1);
    }
  }, [isLoading]);

  // Mic pulse animation
  useEffect(() => {
    if (isListening) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(micPulse, {
            toValue: 1.3,
            duration: 600,
            useNativeDriver: true,
          }),
          Animated.timing(micPulse, {
            toValue: 1,
            duration: 600,
            useNativeDriver: true,
          }),
        ])
      ).start();
    } else {
      micPulse.setValue(1);
    }
  }, [isListening]);

  const playHighQualityVoice = async (text: string, audioBase64?: string) => {
    if (!voiceEnabled) return;
    
    try {
      setIsSpeaking(true);
      
      // Stop any currently playing sound
      if (currentSound) {
        await currentSound.stopAsync();
        await currentSound.unloadAsync();
      }
      
      let base64Audio = audioBase64;
      
      // If no audio provided, fetch from TTS endpoint
      if (!base64Audio) {
        try {
          const response = await fetch(`${BACKEND_URL}/api/tts`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
              text: text.substring(0, 4000),  // TTS limit
              voice: 'onyx'  // Deep, authoritative British-like voice
            }),
          });
          
          if (response.ok) {
            const data = await response.json();
            base64Audio = data.audio_base64;
          }
        } catch (e) {
          console.log('TTS fetch failed, falling back to no voice');
          setIsSpeaking(false);
          return;
        }
      }
      
      if (base64Audio) {
        // Play the audio
        const { sound } = await Audio.Sound.createAsync(
          { uri: `data:audio/mp3;base64,${base64Audio}` },
          { shouldPlay: true }
        );
        
        setCurrentSound(sound);
        
        sound.setOnPlaybackStatusUpdate((status) => {
          if (status.isLoaded && status.didJustFinish) {
            setIsSpeaking(false);
            sound.unloadAsync();
          }
        });
      } else {
        setIsSpeaking(false);
      }
    } catch (error) {
      console.error('Voice playback error:', error);
      setIsSpeaking(false);
    }
  };

  const stopSpeaking = async () => {
    try {
      if (currentSound) {
        await currentSound.stopAsync();
        await currentSound.unloadAsync();
        setCurrentSound(null);
      }
      setIsSpeaking(false);
    } catch (error) {
      console.error('Stop speaking error:', error);
    }
  };

  // Voice recognition using Web Speech API
  const startListening = async () => {
    if (Platform.OS === 'web') {
      try {
        const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
        if (!SpeechRecognition) {
          Alert.alert('Not Supported', 'Speech recognition is not supported in this browser. Please use Chrome or Edge.');
          return;
        }
        
        const recognition = new SpeechRecognition();
        recognition.lang = 'en-US';
        recognition.interimResults = true;
        recognition.continuous = true;
        
        setIsListening(true);
        setTranscript('');
        
        recognition.onresult = (event: any) => {
          let finalTranscript = '';
          let interimTranscript = '';
          
          for (let i = event.resultIndex; i < event.results.length; i++) {
            const result = event.results[i];
            if (result.isFinal) {
              finalTranscript += result[0].transcript;
            } else {
              interimTranscript += result[0].transcript;
            }
          }
          
          setTranscript(finalTranscript || interimTranscript);
          
          if (finalTranscript) {
            setInputText(prev => prev + ' ' + finalTranscript);
          }
        };
        
        recognition.onerror = (event: any) => {
          console.error('Speech recognition error:', event.error);
          setIsListening(false);
          if (event.error === 'not-allowed') {
            Alert.alert('Permission Denied', 'Please allow microphone access to use voice commands.');
          }
        };
        
        recognition.onend = () => {
          // Don't auto-stop, let user control
        };
        
        recognition.start();
        (window as any).currentRecognition = recognition;
        
      } catch (error) {
        console.error('Voice recognition error:', error);
        setIsListening(false);
        Alert.alert('Error', 'Failed to start voice recognition. Please try again.');
      }
    } else {
      Alert.alert(
        'Voice Input',
        'Voice recognition works best on web. On mobile, use the Expo Go app.',
        [{ text: 'OK' }]
      );
    }
  };

  const stopListening = () => {
    if (Platform.OS === 'web' && (window as any).currentRecognition) {
      (window as any).currentRecognition.stop();
    }
    setIsListening(false);
    
    // Auto-send if we have text
    if (inputText.trim()) {
      setTimeout(() => sendMessage(inputText), 300);
    }
  };

  const sendMessage = async (text: string) => {
    if (!text.trim()) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: text.trim(),
      timestamp: new Date(),
    };

    setMessages(prev => [...prev, userMessage]);
    setInputText('');
    setTranscript('');
    setIsLoading(true);
    Keyboard.dismiss();

    try {
      const response = await fetch(`${BACKEND_URL}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text.trim(),
          session_id: sessionId,
          enable_search: searchEnabled,
          enable_voice: voiceEnabled,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to get response');
      }

      const data = await response.json();
      
      if (!sessionId) {
        setSessionId(data.session_id);
      }

      const jarvisMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'jarvis',
        content: data.response,
        timestamp: new Date(data.timestamp),
        searchedWeb: data.searched_web,
        learnedInfo: data.learned_info,
        knowledgeUsed: data.knowledge_used,
        audioBase64: data.audio_base64,
      };

      setMessages(prev => [...prev, jarvisMessage]);
      
      // Play high-quality voice response
      if (data.audio_base64) {
        playHighQualityVoice(data.response, data.audio_base64);
      } else if (voiceEnabled) {
        playHighQualityVoice(data.response);
      }
    } catch (error) {
      console.error('Error:', error);
      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'jarvis',
        content: "I do apologise, Sir, but I'm experiencing some technical difficulties. Might I suggest trying again shortly?",
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, errorMessage]);
      if (voiceEnabled) {
        playHighQualityVoice(errorMessage.content);
      }
    } finally {
      setIsLoading(false);
    }
  };

  const getQuickTime = async () => {
    try {
      const response = await fetch(`${BACKEND_URL}/api/time`);
      const data = await response.json();
      
      const jarvisMessage: Message = {
        id: Date.now().toString(),
        role: 'jarvis',
        content: data.jarvis_response,
        timestamp: new Date(),
      };
      
      setMessages(prev => [...prev, jarvisMessage]);
      if (voiceEnabled) {
        playHighQualityVoice(data.jarvis_response);
      }
    } catch (error) {
      console.error('Time error:', error);
    }
  };

  const scrollToBottom = () => {
    setTimeout(() => {
      scrollViewRef.current?.scrollToEnd({ animated: true });
    }, 100);
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerContent}>
          <Animated.View style={[styles.jarvisIcon, { opacity: glowAnim }]}>
            <View style={styles.arcReactor}>
              <View style={styles.arcReactorInner} />
            </View>
          </Animated.View>
          <View style={styles.headerText}>
            <Text style={styles.title}>J.A.R.V.I.S</Text>
            <Text style={styles.subtitle}>Evolving AI Assistant</Text>
          </View>
          <TouchableOpacity 
            style={styles.settingsButton} 
            onPress={() => router.push('/settings')}
          >
            <Ionicons name="settings-outline" size={24} color="#00d4ff" />
          </TouchableOpacity>
        </View>
        <View style={styles.statusRow}>
          <View style={styles.statusIndicator}>
            <View style={[styles.statusDot, isLoading && styles.statusDotActive, isListening && styles.statusDotListening]} />
            <Text style={styles.statusText}>
              {isListening ? 'Listening...' : isLoading ? 'Thinking...' : 'Online'}
            </Text>
          </View>
          <View style={styles.toggleRow}>
            <TouchableOpacity 
              style={[styles.toggle, searchEnabled && styles.toggleActive]}
              onPress={() => setSearchEnabled(!searchEnabled)}
            >
              <Ionicons name="globe-outline" size={14} color={searchEnabled ? '#00ff88' : '#666'} />
              <Text style={[styles.toggleText, searchEnabled && styles.toggleTextActive]}>Web</Text>
            </TouchableOpacity>
            <TouchableOpacity 
              style={[styles.toggle, voiceEnabled && styles.toggleActive]}
              onPress={() => setVoiceEnabled(!voiceEnabled)}
            >
              <Ionicons name="volume-high-outline" size={14} color={voiceEnabled ? '#00ff88' : '#666'} />
              <Text style={[styles.toggleText, voiceEnabled && styles.toggleTextActive]}>Voice</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>

      {/* Messages */}
      <KeyboardAvoidingView 
        style={styles.messagesContainer}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 20}
      >
        <ScrollView
          ref={scrollViewRef}
          style={styles.messagesList}
          contentContainerStyle={styles.messagesContent}
          showsVerticalScrollIndicator={false}
        >
          {messages.map((message) => (
            <View
              key={message.id}
              style={[
                styles.messageBubble,
                message.role === 'user' ? styles.userBubble : styles.jarvisBubble,
              ]}
            >
              {message.role === 'jarvis' && (
                <View style={styles.jarvisAvatar}>
                  <Ionicons name="hardware-chip" size={16} color="#00d4ff" />
                </View>
              )}
              <View style={[
                styles.messageContent,
                message.role === 'user' ? styles.userContent : styles.jarvisContent
              ]}>
                <Text style={[
                  styles.messageText,
                  message.role === 'user' ? styles.userText : styles.jarvisText
                ]}>
                  {message.content}
                </Text>
                <View style={styles.badgeRow}>
                  {message.searchedWeb && (
                    <View style={styles.badge}>
                      <Ionicons name="globe-outline" size={10} color="#00ff88" />
                      <Text style={styles.badgeText}>Web</Text>
                    </View>
                  )}
                  {message.knowledgeUsed && message.knowledgeUsed > 0 && (
                    <View style={[styles.badge, styles.knowledgeBadge]}>
                      <Ionicons name="library-outline" size={10} color="#00d4ff" />
                      <Text style={[styles.badgeText, { color: '#00d4ff' }]}>{message.knowledgeUsed} knowledge</Text>
                    </View>
                  )}
                  {message.learnedInfo && (
                    <View style={[styles.badge, styles.learnedBadge]}>
                      <Ionicons name="bulb-outline" size={10} color="#ffaa00" />
                      <Text style={[styles.badgeText, { color: '#ffaa00' }]}>Learned</Text>
                    </View>
                  )}
                </View>
              </View>
            </View>
          ))}
          
          {isLoading && (
            <View style={[styles.messageBubble, styles.jarvisBubble]}>
              <View style={styles.jarvisAvatar}>
                <Animated.View style={{ transform: [{ scale: pulseAnim }] }}>
                  <Ionicons name="hardware-chip" size={16} color="#00d4ff" />
                </Animated.View>
              </View>
              <View style={[styles.messageContent, styles.jarvisContent]}>
                <View style={styles.thinkingContainer}>
                  <ActivityIndicator size="small" color="#00d4ff" />
                  <Text style={styles.thinkingText}>Processing...</Text>
                </View>
              </View>
            </View>
          )}
        </ScrollView>

        {/* Voice Transcript Display */}
        {isListening && (
          <View style={styles.transcriptContainer}>
            <View style={styles.listeningIndicator}>
              <Animated.View style={{ transform: [{ scale: micPulse }] }}>
                <Ionicons name="mic" size={20} color="#ff4444" />
              </Animated.View>
              <Text style={styles.listeningText}>Listening...</Text>
            </View>
            {transcript && <Text style={styles.transcriptText}>{transcript}</Text>}
          </View>
        )}

        {/* Quick Actions */}
        <View style={styles.quickActions}>
          <TouchableOpacity style={styles.quickButton} onPress={getQuickTime}>
            <Ionicons name="time-outline" size={16} color="#00d4ff" />
            <Text style={styles.quickButtonText}>Time</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.quickButton} onPress={() => sendMessage("What can you do?")}>
            <Ionicons name="help-circle-outline" size={16} color="#00d4ff" />
            <Text style={styles.quickButtonText}>Help</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.quickButton} onPress={() => sendMessage("Search for the latest tech news")}>
            <Ionicons name="newspaper-outline" size={16} color="#00d4ff" />
            <Text style={styles.quickButtonText}>News</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.quickButton} onPress={() => router.push('/settings')}>
            <Ionicons name="analytics-outline" size={16} color="#00d4ff" />
            <Text style={styles.quickButtonText}>Stats</Text>
          </TouchableOpacity>
          {isSpeaking && (
            <TouchableOpacity style={[styles.quickButton, styles.stopButton]} onPress={stopSpeaking}>
              <Ionicons name="stop" size={16} color="#ff4444" />
              <Text style={[styles.quickButtonText, { color: '#ff4444' }]}>Stop</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Input Area */}
        <View style={styles.inputContainer}>
          <View style={styles.inputWrapper}>
            <TextInput
              style={styles.input}
              value={inputText}
              onChangeText={setInputText}
              placeholder="Speak to JARVIS..."
              placeholderTextColor="#666"
              multiline
              maxLength={1000}
              editable={!isLoading}
            />
            <TouchableOpacity
              style={[styles.sendButton, (!inputText.trim() || isLoading) && styles.sendButtonDisabled]}
              onPress={() => sendMessage(inputText)}
              disabled={!inputText.trim() || isLoading}
            >
              <Ionicons name="send" size={20} color={inputText.trim() && !isLoading ? '#00d4ff' : '#444'} />
            </TouchableOpacity>
          </View>
          
          {/* Live Conversation Button */}
          <TouchableOpacity
            style={[styles.liveConversationButton, isListening && styles.liveConversationButtonActive]}
            onPress={isListening ? stopListening : startListening}
            disabled={isLoading}
          >
            <Animated.View style={isListening ? { transform: [{ scale: micPulse }] } : {}}>
              <View style={[styles.liveButtonInner, isListening && styles.liveButtonInnerActive]}>
                <Ionicons name={isListening ? "stop" : "mic"} size={28} color={isListening ? '#fff' : '#00d4ff'} />
              </View>
            </Animated.View>
            <Text style={[styles.liveButtonText, isListening && styles.liveButtonTextActive]}>
              {isListening ? 'Tap to Send' : 'Tap to Speak'}
            </Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0a0f',
  },
  header: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a2e',
  },
  headerContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  jarvisIcon: {
    marginRight: 10,
  },
  arcReactor: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#001a2e',
    borderWidth: 2,
    borderColor: '#00d4ff',
    justifyContent: 'center',
    alignItems: 'center',
  },
  arcReactorInner: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#00d4ff',
  },
  headerText: {
    flex: 1,
  },
  settingsButton: {
    padding: 8,
  },
  title: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#00d4ff',
    letterSpacing: 2,
  },
  subtitle: {
    fontSize: 10,
    color: '#4a9eff',
    letterSpacing: 1,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 8,
  },
  statusIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#00ff88',
    marginRight: 6,
  },
  statusDotActive: {
    backgroundColor: '#ffaa00',
  },
  statusDotListening: {
    backgroundColor: '#ff4444',
  },
  statusText: {
    fontSize: 11,
    color: '#666',
  },
  toggleRow: {
    flexDirection: 'row',
    gap: 8,
  },
  toggle: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#333',
    gap: 4,
  },
  toggleActive: {
    borderColor: '#00ff88',
    backgroundColor: 'rgba(0, 255, 136, 0.1)',
  },
  toggleText: {
    fontSize: 10,
    color: '#666',
  },
  toggleTextActive: {
    color: '#00ff88',
  },
  messagesContainer: {
    flex: 1,
  },
  messagesList: {
    flex: 1,
  },
  messagesContent: {
    padding: 12,
    paddingBottom: 8,
  },
  messageBubble: {
    flexDirection: 'row',
    marginBottom: 10,
    alignItems: 'flex-start',
  },
  userBubble: {
    justifyContent: 'flex-end',
  },
  jarvisBubble: {
    justifyContent: 'flex-start',
  },
  jarvisAvatar: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: '#0d1b2a',
    borderWidth: 1,
    borderColor: '#00d4ff',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 8,
  },
  messageContent: {
    maxWidth: '80%',
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  userContent: {
    backgroundColor: '#1a3a5c',
    borderBottomRightRadius: 4,
    marginLeft: 'auto',
  },
  jarvisContent: {
    backgroundColor: '#0d1b2a',
    borderWidth: 1,
    borderColor: '#1a3a5c',
    borderBottomLeftRadius: 4,
  },
  messageText: {
    fontSize: 14,
    lineHeight: 20,
  },
  userText: {
    color: '#e0e0e0',
  },
  jarvisText: {
    color: '#b0d4ff',
  },
  badgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 6,
    gap: 6,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 255, 136, 0.1)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
    gap: 3,
  },
  knowledgeBadge: {
    backgroundColor: 'rgba(0, 212, 255, 0.1)',
  },
  learnedBadge: {
    backgroundColor: 'rgba(255, 170, 0, 0.1)',
  },
  badgeText: {
    fontSize: 9,
    color: '#00ff88',
  },
  thinkingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  thinkingText: {
    fontSize: 12,
    color: '#00d4ff',
    fontStyle: 'italic',
  },
  transcriptContainer: {
    backgroundColor: 'rgba(255, 68, 68, 0.1)',
    padding: 10,
    marginHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#ff4444',
  },
  listeningIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
  },
  listeningText: {
    color: '#ff4444',
    fontSize: 12,
    fontWeight: '600',
  },
  transcriptText: {
    color: '#ff8888',
    fontSize: 14,
  },
  quickActions: {
    flexDirection: 'row',
    paddingHorizontal: 12,
    paddingVertical: 6,
    gap: 6,
    flexWrap: 'wrap',
  },
  quickButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: '#0d1b2a',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#1a3a5c',
    gap: 4,
  },
  stopButton: {
    borderColor: '#ff4444',
    backgroundColor: 'rgba(255, 68, 68, 0.1)',
  },
  quickButtonText: {
    color: '#00d4ff',
    fontSize: 11,
    fontWeight: '500',
  },
  inputContainer: {
    padding: 12,
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: '#1a1a2e',
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    backgroundColor: '#0d1b2a',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#1a3a5c',
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  input: {
    flex: 1,
    color: '#fff',
    fontSize: 15,
    maxHeight: 80,
    paddingVertical: 8,
  },
  sendButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#1a3a5c',
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 8,
  },
  sendButtonDisabled: {
    backgroundColor: '#0a1525',
  },
  liveConversationButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 10,
    paddingVertical: 10,
    backgroundColor: '#0d1b2a',
    borderRadius: 25,
    borderWidth: 2,
    borderColor: '#1a3a5c',
    gap: 10,
  },
  liveConversationButtonActive: {
    borderColor: '#ff4444',
    backgroundColor: 'rgba(255, 68, 68, 0.1)',
  },
  liveButtonInner: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#1a3a5c',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#00d4ff',
  },
  liveButtonInnerActive: {
    backgroundColor: '#ff4444',
    borderColor: '#ff4444',
  },
  liveButtonText: {
    color: '#00d4ff',
    fontSize: 14,
    fontWeight: '600',
  },
  liveButtonTextActive: {
    color: '#ff4444',
  },
});
