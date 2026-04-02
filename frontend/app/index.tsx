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
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Speech from 'expo-speech';
import { Audio } from 'expo-av';
import { useRouter } from 'expo-router';

const BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL;

interface Message {
  id: string;
  role: 'user' | 'jarvis';
  content: string;
  timestamp: Date;
}

export default function JarvisScreen() {
  const router = useRouter();
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const scrollViewRef = useRef<ScrollView>(null);
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const glowAnim = useRef(new Animated.Value(0.3)).current;

  // Initialize with a greeting
  useEffect(() => {
    const greeting: Message = {
      id: '1',
      role: 'jarvis',
      content: "Good day. I am JARVIS, your personal AI assistant. How may I assist you today?",
      timestamp: new Date(),
    };
    setMessages([greeting]);
    
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

  const speakResponse = async (text: string) => {
    try {
      setIsSpeaking(true);
      await Speech.speak(text, {
        language: 'en-GB',
        pitch: 1.0,
        rate: 0.9,
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
      };

      setMessages(prev => [...prev, jarvisMessage]);
      
      // Speak the response
      speakResponse(data.response);
    } catch (error) {
      console.error('Error:', error);
      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'jarvis',
        content: "I apologize, but I'm experiencing technical difficulties. Please try again.",
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, errorMessage]);
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
        <View style={styles.statusIndicator}>
          <View style={[styles.statusDot, isLoading && styles.statusDotActive]} />
          <Text style={styles.statusText}>{isLoading ? 'Processing...' : 'Online'}</Text>
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
    paddingVertical: 16,
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
    shadowColor: '#00d4ff',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 10,
    elevation: 10,
  },
  arcReactorInner: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#00d4ff',
    shadowColor: '#00d4ff',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 1,
    shadowRadius: 8,
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
  statusIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
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
  statusText: {
    fontSize: 12,
    color: '#666',
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
  quickActions: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 8,
    gap: 8,
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
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  input: {
    flex: 1,
    color: '#fff',
    fontSize: 16,
    maxHeight: 100,
    paddingVertical: 8,
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
});
