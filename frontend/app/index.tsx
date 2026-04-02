import React, { useState, useRef, useEffect } from 'react';
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
import * as Speech from 'expo-speech';
import { useRouter } from 'expo-router';

const BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL;

interface Message {
  id: string;
  role: 'user' | 'jarvis';
  content: string;
  timestamp: Date;
  searchedWeb?: boolean;
  learnedInfo?: { key: string; value: string } | null;
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
  const [transcript, setTranscript] = useState('');
  const scrollViewRef = useRef<ScrollView>(null);
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const glowAnim = useRef(new Animated.Value(0.3)).current;
  const micPulse = useRef(new Animated.Value(1)).current;

  // Initialize with a greeting
  useEffect(() => {
    const greeting: Message = {
      id: '1',
      role: 'jarvis',
      content: "Good day, Sir. I am JARVIS, your personal AI assistant. I'm at your service and ready to assist with whatever you require. How may I be of help today?",
      timestamp: new Date(),
    };
    setMessages([greeting]);
    
    // Speak greeting with British voice
    speakResponse(greeting.content);
    
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
  }, []);

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

  // Mic pulse animation when listening
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

  const speakResponse = async (text: string) => {
    try {
      setIsSpeaking(true);
      
      // Get available voices and find a British one
      const voices = await Speech.getAvailableVoicesAsync();
      
      // Try to find British English voices
      const britishVoices = voices.filter(v => 
        v.language?.includes('en-GB') || 
        v.identifier?.includes('en-GB') ||
        v.name?.toLowerCase().includes('british') ||
        v.name?.toLowerCase().includes('daniel') ||
        v.name?.toLowerCase().includes('arthur') ||
        v.name?.toLowerCase().includes('oliver')
      );
      
      const voiceToUse = britishVoices[0]?.identifier || undefined;
      
      await Speech.speak(text, {
        language: 'en-GB',
        voice: voiceToUse,
        pitch: 1.0,
        rate: Platform.OS === 'ios' ? 0.52 : 0.9,
        onDone: () => setIsSpeaking(false),
        onError: () => setIsSpeaking(false),
      });
    } catch (error) {
      console.error('Speech error:', error);
      setIsSpeaking(false);
    }
  };

  const stopSpeaking = async () => {
    await Speech.stop();
    setIsSpeaking(false);
  };

  // Voice recognition using Web Speech API (works on web)
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
        recognition.continuous = false;
        
        setIsListening(true);
        setTranscript('');
        
        recognition.onresult = (event: any) => {
          const current = event.resultIndex;
          const result = event.results[current];
          const transcriptText = result[0].transcript;
          setTranscript(transcriptText);
          
          if (result.isFinal) {
            setInputText(transcriptText);
            setIsListening(false);
            // Auto-send after voice input
            setTimeout(() => {
              sendMessage(transcriptText);
            }, 500);
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
          setIsListening(false);
        };
        
        recognition.start();
        
        // Store recognition instance for stopping
        (window as any).currentRecognition = recognition;
        
      } catch (error) {
        console.error('Voice recognition error:', error);
        setIsListening(false);
        Alert.alert('Error', 'Failed to start voice recognition. Please try again.');
      }
    } else {
      // For native platforms, show info about voice input
      Alert.alert(
        'Voice Input',
        'Voice recognition is available on web preview. On mobile devices, use the Expo Go app with a compatible device.',
        [{ text: 'OK' }]
      );
    }
  };

  const stopListening = () => {
    if (Platform.OS === 'web' && (window as any).currentRecognition) {
      (window as any).currentRecognition.stop();
    }
    setIsListening(false);
  };

  const sendMessage = async (text: string) => {
    if (!text.trim()) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: text,
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
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: text,
          session_id: sessionId,
          enable_search: searchEnabled,
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
      };

      setMessages(prev => [...prev, jarvisMessage]);
      
      // Speak the response with British voice
      speakResponse(data.response);
    } catch (error) {
      console.error('Error:', error);
      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'jarvis',
        content: "I do apologise, Sir, but I'm experiencing some technical difficulties at the moment. Might I suggest trying again shortly?",
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, errorMessage]);
      speakResponse(errorMessage.content);
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
      speakResponse(data.jarvis_response);
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
            <Text style={styles.subtitle}>Just A Rather Very Intelligent System</Text>
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
              {isListening ? 'Listening...' : isLoading ? 'Processing...' : 'Online'}
            </Text>
          </View>
          <TouchableOpacity 
            style={[styles.searchToggle, searchEnabled && styles.searchToggleActive]}
            onPress={() => setSearchEnabled(!searchEnabled)}
          >
            <Ionicons name="globe-outline" size={16} color={searchEnabled ? '#00ff88' : '#666'} />
            <Text style={[styles.searchToggleText, searchEnabled && styles.searchToggleTextActive]}>
              Web Search
            </Text>
          </TouchableOpacity>
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
                {message.searchedWeb && (
                  <View style={styles.searchBadge}>
                    <Ionicons name="globe-outline" size={12} color="#00ff88" />
                    <Text style={styles.searchBadgeText}>Web search used</Text>
                  </View>
                )}
                {message.learnedInfo && (
                  <View style={styles.learnedBadge}>
                    <Ionicons name="bulb-outline" size={12} color="#ffaa00" />
                    <Text style={styles.learnedBadgeText}>
                      Learned: {message.learnedInfo.key}
                    </Text>
                  </View>
                )}
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
                <ActivityIndicator size="small" color="#00d4ff" />
              </View>
            </View>
          )}
        </ScrollView>

        {/* Voice Transcript Display */}
        {isListening && transcript && (
          <View style={styles.transcriptContainer}>
            <Text style={styles.transcriptText}>{transcript}</Text>
          </View>
        )}

        {/* Quick Actions */}
        <View style={styles.quickActions}>
          <TouchableOpacity style={styles.quickButton} onPress={getQuickTime}>
            <Ionicons name="time-outline" size={18} color="#00d4ff" />
            <Text style={styles.quickButtonText}>Time</Text>
          </TouchableOpacity>
          <TouchableOpacity 
            style={styles.quickButton} 
            onPress={() => sendMessage("What can you do?")}
          >
            <Ionicons name="help-circle-outline" size={18} color="#00d4ff" />
            <Text style={styles.quickButtonText}>Help</Text>
          </TouchableOpacity>
          <TouchableOpacity 
            style={styles.quickButton} 
            onPress={() => sendMessage("Search for the latest news")}
          >
            <Ionicons name="newspaper-outline" size={18} color="#00d4ff" />
            <Text style={styles.quickButtonText}>News</Text>
          </TouchableOpacity>
          {isSpeaking && (
            <TouchableOpacity style={[styles.quickButton, styles.stopButton]} onPress={stopSpeaking}>
              <Ionicons name="volume-mute" size={18} color="#ff4444" />
              <Text style={[styles.quickButtonText, { color: '#ff4444' }]}>Stop</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Input Area */}
        <View style={styles.inputContainer}>
          <View style={styles.inputWrapper}>
            {/* Voice Button */}
            <TouchableOpacity
              style={[
                styles.voiceButton,
                isListening && styles.voiceButtonActive,
              ]}
              onPress={isListening ? stopListening : startListening}
              disabled={isLoading}
            >
              <Animated.View style={isListening ? { transform: [{ scale: micPulse }] } : {}}>
                <Ionicons
                  name={isListening ? "mic" : "mic-outline"}
                  size={24}
                  color={isListening ? '#ff4444' : '#00d4ff'}
                />
              </Animated.View>
            </TouchableOpacity>
            
            <TextInput
              style={styles.input}
              value={isListening ? transcript : inputText}
              onChangeText={setInputText}
              placeholder={isListening ? "Listening..." : "Speak to JARVIS..."}
              placeholderTextColor="#666"
              multiline
              maxLength={1000}
              editable={!isLoading && !isListening}
            />
            <TouchableOpacity
              style={[
                styles.sendButton,
                (!inputText.trim() || isLoading) && styles.sendButtonDisabled,
              ]}
              onPress={() => sendMessage(inputText)}
              disabled={!inputText.trim() || isLoading}
            >
              <Ionicons
                name="send"
                size={20}
                color={inputText.trim() && !isLoading ? '#00d4ff' : '#444'}
              />
            </TouchableOpacity>
          </View>
          
          {/* Live Conversation Button */}
          <TouchableOpacity
            style={[
              styles.liveConversationButton,
              isListening && styles.liveConversationButtonActive,
            ]}
            onPress={isListening ? stopListening : startListening}
            disabled={isLoading}
          >
            <Animated.View style={isListening ? { transform: [{ scale: micPulse }] } : {}}>
              <View style={[styles.liveButtonInner, isListening && styles.liveButtonInnerActive]}>
                <Ionicons
                  name={isListening ? "stop" : "mic"}
                  size={28}
                  color={isListening ? '#fff' : '#00d4ff'}
                />
              </View>
            </Animated.View>
            <Text style={[styles.liveButtonText, isListening && styles.liveButtonTextActive]}>
              {isListening ? 'Tap to Stop' : 'Hold to Speak'}
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
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a2e',
  },
  headerContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  jarvisIcon: {
    marginRight: 12,
  },
  arcReactor: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#001a2e',
    borderWidth: 2,
    borderColor: '#00d4ff',
    justifyContent: 'center',
    alignItems: 'center',
  },
  arcReactorInner: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#00d4ff',
  },
  headerText: {
    flex: 1,
  },
  settingsButton: {
    padding: 8,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#00d4ff',
    letterSpacing: 2,
  },
  subtitle: {
    fontSize: 10,
    color: '#4a9eff',
    letterSpacing: 1,
    marginTop: 2,
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
    marginRight: 8,
  },
  statusDotActive: {
    backgroundColor: '#ffaa00',
  },
  statusDotListening: {
    backgroundColor: '#ff4444',
  },
  statusText: {
    fontSize: 12,
    color: '#666',
  },
  searchToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#333',
    gap: 4,
  },
  searchToggleActive: {
    borderColor: '#00ff88',
    backgroundColor: 'rgba(0, 255, 136, 0.1)',
  },
  searchToggleText: {
    fontSize: 11,
    color: '#666',
  },
  searchToggleTextActive: {
    color: '#00ff88',
  },
  messagesContainer: {
    flex: 1,
  },
  messagesList: {
    flex: 1,
  },
  messagesContent: {
    padding: 16,
    paddingBottom: 8,
  },
  messageBubble: {
    flexDirection: 'row',
    marginBottom: 12,
    alignItems: 'flex-start',
  },
  userBubble: {
    justifyContent: 'flex-end',
  },
  jarvisBubble: {
    justifyContent: 'flex-start',
  },
  jarvisAvatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#0d1b2a',
    borderWidth: 1,
    borderColor: '#00d4ff',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 8,
  },
  messageContent: {
    maxWidth: '80%',
    borderRadius: 16,
    paddingHorizontal: 14,
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
    fontSize: 15,
    lineHeight: 22,
  },
  userText: {
    color: '#e0e0e0',
  },
  jarvisText: {
    color: '#b0d4ff',
  },
  searchBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
    gap: 4,
  },
  searchBadgeText: {
    fontSize: 10,
    color: '#00ff88',
  },
  learnedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
    gap: 4,
  },
  learnedBadgeText: {
    fontSize: 10,
    color: '#ffaa00',
  },
  transcriptContainer: {
    backgroundColor: 'rgba(255, 68, 68, 0.1)',
    padding: 12,
    marginHorizontal: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ff4444',
  },
  transcriptText: {
    color: '#ff8888',
    fontSize: 14,
    fontStyle: 'italic',
  },
  quickActions: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 8,
    gap: 8,
    flexWrap: 'wrap',
  },
  quickButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#0d1b2a',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#1a3a5c',
    gap: 6,
  },
  stopButton: {
    borderColor: '#ff4444',
  },
  quickButtonText: {
    color: '#00d4ff',
    fontSize: 13,
    fontWeight: '500',
  },
  inputContainer: {
    padding: 16,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#1a1a2e',
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    backgroundColor: '#0d1b2a',
    borderRadius: 24,
    borderWidth: 1,
    borderColor: '#1a3a5c',
    paddingHorizontal: 8,
    paddingVertical: 8,
  },
  voiceButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#1a3a5c',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 8,
  },
  voiceButtonActive: {
    backgroundColor: 'rgba(255, 68, 68, 0.2)',
    borderWidth: 1,
    borderColor: '#ff4444',
  },
  input: {
    flex: 1,
    color: '#fff',
    fontSize: 16,
    maxHeight: 100,
    paddingVertical: 8,
    paddingHorizontal: 8,
  },
  sendButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
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
    marginTop: 12,
    paddingVertical: 12,
    backgroundColor: '#0d1b2a',
    borderRadius: 30,
    borderWidth: 2,
    borderColor: '#1a3a5c',
    gap: 12,
  },
  liveConversationButtonActive: {
    borderColor: '#ff4444',
    backgroundColor: 'rgba(255, 68, 68, 0.1)',
  },
  liveButtonInner: {
    width: 50,
    height: 50,
    borderRadius: 25,
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
    fontSize: 16,
    fontWeight: '600',
  },
  liveButtonTextActive: {
    color: '#ff4444',
  },
});
