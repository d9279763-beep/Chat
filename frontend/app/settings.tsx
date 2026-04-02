import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Modal,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';

const BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL;

interface CustomCommand {
  id: string;
  trigger: string;
  action: string;
  description: string;
  usage_count: number;
}

interface Memory {
  id: string;
  key: string;
  value: string;
  learned_from: string;
}

interface HabitStats {
  total_interactions: number;
  most_active_hour: string | null;
  most_active_day: string | null;
  action_breakdown: Record<string, number>;
}

interface TrainingStats {
  total_conversations: number;
  total_knowledge_entries: number;
  total_memories: number;
  most_discussed_topics: Record<string, number>;
  learning_rate: number;
}

export default function SettingsScreen() {
  const router = useRouter();
  const [commands, setCommands] = useState<CustomCommand[]>([]);
  const [memories, setMemories] = useState<Memory[]>([]);
  const [habitStats, setHabitStats] = useState<HabitStats | null>(null);
  const [trainingStats, setTrainingStats] = useState<TrainingStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [showCommandModal, setShowCommandModal] = useState(false);
  const [showMemoryModal, setShowMemoryModal] = useState(false);
  const [newCommand, setNewCommand] = useState({ trigger: '', action: '', description: '' });
  const [newMemory, setNewMemory] = useState({ key: '', value: '', learned_from: '' });

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setIsLoading(true);
    try {
      const [commandsRes, memoriesRes, habitsRes, trainingRes] = await Promise.all([
        fetch(`${BACKEND_URL}/api/commands`),
        fetch(`${BACKEND_URL}/api/memory`),
        fetch(`${BACKEND_URL}/api/habits/stats`),
        fetch(`${BACKEND_URL}/api/training/stats`),
      ]);

      if (commandsRes.ok) setCommands(await commandsRes.json());
      if (memoriesRes.ok) setMemories(await memoriesRes.json());
      if (habitsRes.ok) setHabitStats(await habitsRes.json());
      if (trainingRes.ok) setTrainingStats(await trainingRes.json());
    } catch (error) {
      console.error('Error loading data:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const createCommand = async () => {
    if (!newCommand.trigger || !newCommand.action) {
      Alert.alert('Error', 'Please fill in trigger and action');
      return;
    }

    try {
      const response = await fetch(`${BACKEND_URL}/api/commands`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newCommand),
      });

      if (response.ok) {
        const created = await response.json();
        setCommands([...commands, created]);
        setNewCommand({ trigger: '', action: '', description: '' });
        setShowCommandModal(false);
      }
    } catch (error) {
      console.error('Error creating command:', error);
    }
  };

  const deleteCommand = async (id: string) => {
    try {
      const response = await fetch(`${BACKEND_URL}/api/commands/${id}`, {
        method: 'DELETE',
      });

      if (response.ok) {
        setCommands(commands.filter(c => c.id !== id));
      }
    } catch (error) {
      console.error('Error deleting command:', error);
    }
  };

  const saveMemory = async () => {
    if (!newMemory.key || !newMemory.value) {
      Alert.alert('Error', 'Please fill in key and value');
      return;
    }

    try {
      const response = await fetch(`${BACKEND_URL}/api/memory`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newMemory),
      });

      if (response.ok) {
        const saved = await response.json();
        const existing = memories.findIndex(m => m.key === saved.key);
        if (existing >= 0) {
          const updated = [...memories];
          updated[existing] = saved;
          setMemories(updated);
        } else {
          setMemories([...memories, saved]);
        }
        setNewMemory({ key: '', value: '', learned_from: '' });
        setShowMemoryModal(false);
      }
    } catch (error) {
      console.error('Error saving memory:', error);
    }
  };

  const deleteMemory = async (key: string) => {
    try {
      const response = await fetch(`${BACKEND_URL}/api/memory/${key}`, {
        method: 'DELETE',
      });

      if (response.ok) {
        setMemories(memories.filter(m => m.key !== key));
      }
    } catch (error) {
      console.error('Error deleting memory:', error);
    }
  };

  if (isLoading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#00d4ff" />
          <Text style={styles.loadingText}>Loading JARVIS data...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Ionicons name="chevron-back" size={24} color="#00d4ff" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>JARVIS Settings</Text>
        <TouchableOpacity onPress={loadData} style={styles.refreshButton}>
          <Ionicons name="refresh" size={22} color="#00d4ff" />
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        {/* Training Brain Stats */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Ionicons name="fitness-outline" size={20} color="#00d4ff" />
            <Text style={styles.sectionTitle}>JARVIS Brain</Text>
          </View>
          <View style={styles.brainCard}>
            <View style={styles.brainStat}>
              <Ionicons name="library-outline" size={28} color="#00d4ff" />
              <Text style={styles.brainValue}>{trainingStats?.total_knowledge_entries || 0}</Text>
              <Text style={styles.brainLabel}>Knowledge Entries</Text>
            </View>
            <View style={styles.brainStat}>
              <Ionicons name="chatbubbles-outline" size={28} color="#4a9eff" />
              <Text style={styles.brainValue}>{trainingStats?.total_conversations || 0}</Text>
              <Text style={styles.brainLabel}>Conversations</Text>
            </View>
            <View style={styles.brainStat}>
              <Ionicons name="trending-up-outline" size={28} color="#00ff88" />
              <Text style={styles.brainValue}>{trainingStats?.learning_rate || 0}</Text>
              <Text style={styles.brainLabel}>Learning Rate</Text>
            </View>
          </View>
          <Text style={styles.evolutionText}>
            JARVIS evolves with every conversation, building a comprehensive knowledge base that makes responses smarter over time.
          </Text>
        </View>

        {/* Usage Analytics */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Ionicons name="analytics-outline" size={20} color="#00d4ff" />
            <Text style={styles.sectionTitle}>Usage Analytics</Text>
          </View>
          <View style={styles.statsGrid}>
            <View style={styles.statCard}>
              <Text style={styles.statValue}>{habitStats?.total_interactions || 0}</Text>
              <Text style={styles.statLabel}>Total Interactions</Text>
            </View>
            <View style={styles.statCard}>
              <Text style={styles.statValue}>{habitStats?.most_active_hour || 'N/A'}</Text>
              <Text style={styles.statLabel}>Peak Hour</Text>
            </View>
            <View style={styles.statCard}>
              <Text style={styles.statValue}>{habitStats?.most_active_day || 'N/A'}</Text>
              <Text style={styles.statLabel}>Peak Day</Text>
            </View>
          </View>
        </View>

        {/* Custom Commands */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Ionicons name="terminal-outline" size={20} color="#00d4ff" />
            <Text style={styles.sectionTitle}>Custom Commands</Text>
            <TouchableOpacity 
              style={styles.addButton}
              onPress={() => setShowCommandModal(true)}
            >
              <Ionicons name="add" size={20} color="#00d4ff" />
            </TouchableOpacity>
          </View>
          
          {commands.length === 0 ? (
            <Text style={styles.emptyText}>No custom commands yet. Create one to get started!</Text>
          ) : (
            commands.map((cmd) => (
              <View key={cmd.id} style={styles.itemCard}>
                <View style={styles.itemContent}>
                  <Text style={styles.itemTrigger}>"{cmd.trigger}"</Text>
                  <Text style={styles.itemAction}>{cmd.action}</Text>
                  {cmd.description && (
                    <Text style={styles.itemDescription}>{cmd.description}</Text>
                  )}
                  <Text style={styles.itemUsage}>Used {cmd.usage_count} times</Text>
                </View>
                <TouchableOpacity 
                  style={styles.deleteButton}
                  onPress={() => deleteCommand(cmd.id)}
                >
                  <Ionicons name="trash-outline" size={18} color="#ff4444" />
                </TouchableOpacity>
              </View>
            ))
          )}
        </View>

        {/* JARVIS Memories */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Ionicons name="bulb-outline" size={20} color="#00d4ff" />
            <Text style={styles.sectionTitle}>JARVIS Memory</Text>
            <TouchableOpacity 
              style={styles.addButton}
              onPress={() => setShowMemoryModal(true)}
            >
              <Ionicons name="add" size={20} color="#00d4ff" />
            </TouchableOpacity>
          </View>
          
          {memories.length === 0 ? (
            <Text style={styles.emptyText}>JARVIS hasn't learned anything yet. Teach it something!</Text>
          ) : (
            memories.map((mem) => (
              <View key={mem.id} style={styles.itemCard}>
                <View style={styles.itemContent}>
                  <Text style={styles.itemTrigger}>{mem.key}</Text>
                  <Text style={styles.itemAction}>{mem.value}</Text>
                  {mem.learned_from && (
                    <Text style={styles.itemDescription}>Learned from: {mem.learned_from}</Text>
                  )}
                </View>
                <TouchableOpacity 
                  style={styles.deleteButton}
                  onPress={() => deleteMemory(mem.key)}
                >
                  <Ionicons name="trash-outline" size={18} color="#ff4444" />
                </TouchableOpacity>
              </View>
            ))
          )}
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>

      {/* Create Command Modal */}
      <Modal
        visible={showCommandModal}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setShowCommandModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Create Custom Command</Text>
            
            <Text style={styles.inputLabel}>Trigger Phrase</Text>
            <TextInput
              style={styles.modalInput}
              value={newCommand.trigger}
              onChangeText={(text) => setNewCommand({ ...newCommand, trigger: text })}
              placeholder="e.g., good morning"
              placeholderTextColor="#666"
            />

            <Text style={styles.inputLabel}>Action</Text>
            <TextInput
              style={[styles.modalInput, styles.multilineInput]}
              value={newCommand.action}
              onChangeText={(text) => setNewCommand({ ...newCommand, action: text })}
              placeholder="e.g., Tell me the time and today's tasks"
              placeholderTextColor="#666"
              multiline
            />

            <Text style={styles.inputLabel}>Description (optional)</Text>
            <TextInput
              style={styles.modalInput}
              value={newCommand.description}
              onChangeText={(text) => setNewCommand({ ...newCommand, description: text })}
              placeholder="e.g., Morning routine"
              placeholderTextColor="#666"
            />

            <View style={styles.modalButtons}>
              <TouchableOpacity 
                style={styles.cancelButton}
                onPress={() => setShowCommandModal(false)}
              >
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity 
                style={styles.saveButton}
                onPress={createCommand}
              >
                <Text style={styles.saveButtonText}>Create</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Create Memory Modal */}
      <Modal
        visible={showMemoryModal}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setShowMemoryModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Teach JARVIS</Text>
            
            <Text style={styles.inputLabel}>What to remember (key)</Text>
            <TextInput
              style={styles.modalInput}
              value={newMemory.key}
              onChangeText={(text) => setNewMemory({ ...newMemory, key: text })}
              placeholder="e.g., user_name, favorite_color"
              placeholderTextColor="#666"
            />

            <Text style={styles.inputLabel}>Value</Text>
            <TextInput
              style={styles.modalInput}
              value={newMemory.value}
              onChangeText={(text) => setNewMemory({ ...newMemory, value: text })}
              placeholder="e.g., Tony, Blue"
              placeholderTextColor="#666"
            />

            <Text style={styles.inputLabel}>Context (optional)</Text>
            <TextInput
              style={styles.modalInput}
              value={newMemory.learned_from}
              onChangeText={(text) => setNewMemory({ ...newMemory, learned_from: text })}
              placeholder="e.g., User told me directly"
              placeholderTextColor="#666"
            />

            <View style={styles.modalButtons}>
              <TouchableOpacity 
                style={styles.cancelButton}
                onPress={() => setShowMemoryModal(false)}
              >
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity 
                style={styles.saveButton}
                onPress={saveMemory}
              >
                <Text style={styles.saveButtonText}>Save</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0a0f',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    color: '#00d4ff',
    marginTop: 16,
    fontSize: 16,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a2e',
  },
  backButton: {
    padding: 8,
  },
  headerTitle: {
    flex: 1,
    fontSize: 20,
    fontWeight: 'bold',
    color: '#00d4ff',
    textAlign: 'center',
  },
  refreshButton: {
    padding: 8,
  },
  content: {
    flex: 1,
    padding: 16,
  },
  section: {
    marginBottom: 24,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
    gap: 8,
  },
  sectionTitle: {
    flex: 1,
    fontSize: 18,
    fontWeight: '600',
    color: '#fff',
  },
  addButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#0d1b2a',
    borderWidth: 1,
    borderColor: '#00d4ff',
    justifyContent: 'center',
    alignItems: 'center',
  },
  statsGrid: {
    flexDirection: 'row',
    gap: 12,
  },
  statCard: {
    flex: 1,
    backgroundColor: '#0d1b2a',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#1a3a5c',
    alignItems: 'center',
  },
  statValue: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#00d4ff',
    marginBottom: 4,
  },
  statLabel: {
    fontSize: 11,
    color: '#888',
    textAlign: 'center',
  },
  brainCard: {
    flexDirection: 'row',
    backgroundColor: '#0d1b2a',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#1a3a5c',
    justifyContent: 'space-around',
  },
  brainStat: {
    alignItems: 'center',
    gap: 6,
  },
  brainValue: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#fff',
  },
  brainLabel: {
    fontSize: 10,
    color: '#888',
    textAlign: 'center',
  },
  evolutionText: {
    fontSize: 12,
    color: '#666',
    marginTop: 12,
    textAlign: 'center',
    fontStyle: 'italic',
  },
  emptyText: {
    color: '#666',
    fontStyle: 'italic',
    textAlign: 'center',
    padding: 20,
  },
  itemCard: {
    flexDirection: 'row',
    backgroundColor: '#0d1b2a',
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#1a3a5c',
  },
  itemContent: {
    flex: 1,
  },
  itemTrigger: {
    fontSize: 16,
    fontWeight: '600',
    color: '#00d4ff',
    marginBottom: 4,
  },
  itemAction: {
    fontSize: 14,
    color: '#b0d4ff',
    marginBottom: 4,
  },
  itemDescription: {
    fontSize: 12,
    color: '#666',
    marginBottom: 4,
  },
  itemUsage: {
    fontSize: 11,
    color: '#4a9eff',
  },
  deleteButton: {
    padding: 8,
    justifyContent: 'center',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    justifyContent: 'center',
    padding: 20,
  },
  modalContent: {
    backgroundColor: '#0d1b2a',
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: '#1a3a5c',
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#00d4ff',
    marginBottom: 20,
    textAlign: 'center',
  },
  inputLabel: {
    fontSize: 14,
    color: '#888',
    marginBottom: 6,
  },
  modalInput: {
    backgroundColor: '#0a0a0f',
    borderRadius: 10,
    padding: 14,
    color: '#fff',
    fontSize: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#1a3a5c',
  },
  multilineInput: {
    minHeight: 80,
    textAlignVertical: 'top',
  },
  modalButtons: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 8,
  },
  cancelButton: {
    flex: 1,
    padding: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#666',
    alignItems: 'center',
  },
  cancelButtonText: {
    color: '#888',
    fontSize: 16,
    fontWeight: '600',
  },
  saveButton: {
    flex: 1,
    padding: 14,
    borderRadius: 10,
    backgroundColor: '#00d4ff',
    alignItems: 'center',
  },
  saveButtonText: {
    color: '#000',
    fontSize: 16,
    fontWeight: '600',
  },
});
