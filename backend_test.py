#!/usr/bin/env python3
"""
Comprehensive Backend API Testing for Jarvis AI Assistant
Tests all backend endpoints systematically
"""

import requests
import json
import uuid
from datetime import datetime
import time

# Configuration
BASE_URL = "https://evolving-jarvis-1.preview.emergentagent.com/api"
TIMEOUT = 30

class JarvisAPITester:
    def __init__(self):
        self.session = requests.Session()
        self.session.timeout = TIMEOUT
        self.test_session_id = str(uuid.uuid4())
        self.test_command_id = None
        self.test_memory_key = "test_user_name"
        self.results = {
            "health_check": False,
            "chat": False,
            "time": False,
            "commands_create": False,
            "commands_list": False,
            "commands_delete": False,
            "memory_save": False,
            "memory_list": False,
            "memory_delete": False,
            "habits_stats": False,
            "chat_history_get": False,
            "chat_history_delete": False
        }
        self.errors = []

    def log_error(self, test_name, error):
        error_msg = f"{test_name}: {str(error)}"
        self.errors.append(error_msg)
        print(f"❌ {error_msg}")

    def log_success(self, test_name, details=""):
        print(f"✅ {test_name} {details}")

    def test_health_check(self):
        """Test GET /api/health"""
        try:
            print("\n🔍 Testing Health Check Endpoint...")
            response = self.session.get(f"{BASE_URL}/health")
            
            if response.status_code == 200:
                data = response.json()
                if data.get("status") == "healthy" and data.get("jarvis") == "online":
                    self.results["health_check"] = True
                    self.log_success("Health Check", f"- Status: {data.get('status')}")
                    return True
                else:
                    self.log_error("Health Check", f"Invalid response format: {data}")
            else:
                self.log_error("Health Check", f"HTTP {response.status_code}: {response.text}")
                
        except Exception as e:
            self.log_error("Health Check", e)
        return False

    def test_chat_endpoint(self):
        """Test POST /api/chat"""
        try:
            print("\n🔍 Testing Chat with Jarvis Endpoint...")
            
            # Test basic chat
            chat_data = {
                "message": "Hello Jarvis, what can you do?",
                "session_id": self.test_session_id
            }
            
            response = self.session.post(
                f"{BASE_URL}/chat",
                json=chat_data,
                headers={"Content-Type": "application/json"}
            )
            
            if response.status_code == 200:
                data = response.json()
                if (data.get("response") and 
                    data.get("session_id") == self.test_session_id and
                    data.get("timestamp")):
                    self.results["chat"] = True
                    self.log_success("Chat Endpoint", f"- Response length: {len(data.get('response', ''))}")
                    
                    # Test if response has Jarvis personality (British, sophisticated)
                    response_text = data.get("response", "").lower()
                    if any(word in response_text for word in ["sir", "ma'am", "assist", "help", "jarvis"]):
                        self.log_success("Chat Personality", "- Jarvis personality detected")
                    
                    return True
                else:
                    self.log_error("Chat Endpoint", f"Invalid response format: {data}")
            else:
                self.log_error("Chat Endpoint", f"HTTP {response.status_code}: {response.text}")
                
        except Exception as e:
            self.log_error("Chat Endpoint", e)
        return False

    def test_time_endpoint(self):
        """Test GET /api/time"""
        try:
            print("\n🔍 Testing Quick Time Endpoint...")
            response = self.session.get(f"{BASE_URL}/time")
            
            if response.status_code == 200:
                data = response.json()
                if (data.get("time") and 
                    data.get("date") and 
                    data.get("jarvis_response")):
                    self.results["time"] = True
                    self.log_success("Time Endpoint", f"- Time: {data.get('time')}")
                    return True
                else:
                    self.log_error("Time Endpoint", f"Invalid response format: {data}")
            else:
                self.log_error("Time Endpoint", f"HTTP {response.status_code}: {response.text}")
                
        except Exception as e:
            self.log_error("Time Endpoint", e)
        return False

    def test_commands_crud(self):
        """Test Custom Commands CRUD operations"""
        try:
            print("\n🔍 Testing Custom Commands CRUD...")
            
            # Test CREATE command
            command_data = {
                "trigger": "good morning",
                "action": "Tell me the time and weather",
                "description": "Morning routine command"
            }
            
            response = self.session.post(
                f"{BASE_URL}/commands",
                json=command_data,
                headers={"Content-Type": "application/json"}
            )
            
            if response.status_code == 200:
                data = response.json()
                if (data.get("id") and 
                    data.get("trigger") == command_data["trigger"] and
                    data.get("action") == command_data["action"]):
                    self.results["commands_create"] = True
                    self.test_command_id = data.get("id")
                    self.log_success("Commands CREATE", f"- ID: {self.test_command_id}")
                else:
                    self.log_error("Commands CREATE", f"Invalid response format: {data}")
                    return False
            else:
                self.log_error("Commands CREATE", f"HTTP {response.status_code}: {response.text}")
                return False
            
            # Test LIST commands
            response = self.session.get(f"{BASE_URL}/commands")
            
            if response.status_code == 200:
                data = response.json()
                if isinstance(data, list) and len(data) > 0:
                    # Check if our created command is in the list
                    found_command = any(cmd.get("id") == self.test_command_id for cmd in data)
                    if found_command:
                        self.results["commands_list"] = True
                        self.log_success("Commands LIST", f"- Found {len(data)} commands")
                    else:
                        self.log_error("Commands LIST", "Created command not found in list")
                else:
                    self.log_error("Commands LIST", f"Invalid response format: {data}")
                    return False
            else:
                self.log_error("Commands LIST", f"HTTP {response.status_code}: {response.text}")
                return False
            
            # Test DELETE command
            if self.test_command_id:
                response = self.session.delete(f"{BASE_URL}/commands/{self.test_command_id}")
                
                if response.status_code == 200:
                    data = response.json()
                    if data.get("message"):
                        self.results["commands_delete"] = True
                        self.log_success("Commands DELETE", "- Command deleted successfully")
                    else:
                        self.log_error("Commands DELETE", f"Invalid response format: {data}")
                else:
                    self.log_error("Commands DELETE", f"HTTP {response.status_code}: {response.text}")
            
            return True
                
        except Exception as e:
            self.log_error("Commands CRUD", e)
        return False

    def test_memory_crud(self):
        """Test Memory/Learning CRUD operations"""
        try:
            print("\n🔍 Testing Memory/Learning CRUD...")
            
            # Test SAVE memory
            memory_data = {
                "key": self.test_memory_key,
                "value": "Tony Stark",
                "learned_from": "User introduction during testing"
            }
            
            response = self.session.post(
                f"{BASE_URL}/memory",
                json=memory_data,
                headers={"Content-Type": "application/json"}
            )
            
            if response.status_code == 200:
                data = response.json()
                if (data.get("key") == memory_data["key"] and 
                    data.get("value") == memory_data["value"]):
                    self.results["memory_save"] = True
                    self.log_success("Memory SAVE", f"- Key: {data.get('key')}")
                else:
                    self.log_error("Memory SAVE", f"Invalid response format: {data}")
                    return False
            else:
                self.log_error("Memory SAVE", f"HTTP {response.status_code}: {response.text}")
                return False
            
            # Test LIST memories
            response = self.session.get(f"{BASE_URL}/memory")
            
            if response.status_code == 200:
                data = response.json()
                if isinstance(data, list):
                    # Check if our created memory is in the list
                    found_memory = any(mem.get("key") == self.test_memory_key for mem in data)
                    if found_memory:
                        self.results["memory_list"] = True
                        self.log_success("Memory LIST", f"- Found {len(data)} memories")
                    else:
                        self.log_error("Memory LIST", "Created memory not found in list")
                else:
                    self.log_error("Memory LIST", f"Invalid response format: {data}")
                    return False
            else:
                self.log_error("Memory LIST", f"HTTP {response.status_code}: {response.text}")
                return False
            
            # Test DELETE memory
            response = self.session.delete(f"{BASE_URL}/memory/{self.test_memory_key}")
            
            if response.status_code == 200:
                data = response.json()
                if data.get("message"):
                    self.results["memory_delete"] = True
                    self.log_success("Memory DELETE", "- Memory deleted successfully")
                else:
                    self.log_error("Memory DELETE", f"Invalid response format: {data}")
            else:
                self.log_error("Memory DELETE", f"HTTP {response.status_code}: {response.text}")
            
            return True
                
        except Exception as e:
            self.log_error("Memory CRUD", e)
        return False

    def test_habits_stats(self):
        """Test GET /api/habits/stats"""
        try:
            print("\n🔍 Testing Habit Statistics Endpoint...")
            response = self.session.get(f"{BASE_URL}/habits/stats")
            
            if response.status_code == 200:
                data = response.json()
                if ("total_interactions" in data and 
                    "action_breakdown" in data):
                    self.results["habits_stats"] = True
                    self.log_success("Habits Stats", f"- Total interactions: {data.get('total_interactions')}")
                    return True
                else:
                    self.log_error("Habits Stats", f"Invalid response format: {data}")
            else:
                self.log_error("Habits Stats", f"HTTP {response.status_code}: {response.text}")
                
        except Exception as e:
            self.log_error("Habits Stats", e)
        return False

    def test_chat_history(self):
        """Test Chat History endpoints"""
        try:
            print("\n🔍 Testing Chat History Endpoints...")
            
            # Test GET chat history
            response = self.session.get(f"{BASE_URL}/chat/history/{self.test_session_id}")
            
            if response.status_code == 200:
                data = response.json()
                if isinstance(data, list):
                    self.results["chat_history_get"] = True
                    self.log_success("Chat History GET", f"- Found {len(data)} messages")
                else:
                    self.log_error("Chat History GET", f"Invalid response format: {data}")
                    return False
            else:
                self.log_error("Chat History GET", f"HTTP {response.status_code}: {response.text}")
                return False
            
            # Test DELETE chat history
            response = self.session.delete(f"{BASE_URL}/chat/history/{self.test_session_id}")
            
            if response.status_code == 200:
                data = response.json()
                if data.get("message"):
                    self.results["chat_history_delete"] = True
                    self.log_success("Chat History DELETE", "- History cleared successfully")
                else:
                    self.log_error("Chat History DELETE", f"Invalid response format: {data}")
            else:
                self.log_error("Chat History DELETE", f"HTTP {response.status_code}: {response.text}")
            
            return True
                
        except Exception as e:
            self.log_error("Chat History", e)
        return False

    def run_all_tests(self):
        """Run all backend API tests"""
        print("🚀 Starting Jarvis AI Assistant Backend API Tests")
        print(f"📍 Base URL: {BASE_URL}")
        print("=" * 60)
        
        # Run tests in logical order
        self.test_health_check()
        self.test_time_endpoint()
        self.test_chat_endpoint()
        self.test_commands_crud()
        self.test_memory_crud()
        self.test_habits_stats()
        self.test_chat_history()
        
        # Print summary
        print("\n" + "=" * 60)
        print("📊 TEST RESULTS SUMMARY")
        print("=" * 60)
        
        passed = sum(1 for result in self.results.values() if result)
        total = len(self.results)
        
        for test_name, result in self.results.items():
            status = "✅ PASS" if result else "❌ FAIL"
            print(f"{status} {test_name.replace('_', ' ').title()}")
        
        print(f"\n🎯 Overall: {passed}/{total} tests passed ({(passed/total)*100:.1f}%)")
        
        if self.errors:
            print(f"\n🚨 ERRORS ENCOUNTERED ({len(self.errors)}):")
            for error in self.errors:
                print(f"   • {error}")
        
        return passed == total

if __name__ == "__main__":
    tester = JarvisAPITester()
    success = tester.run_all_tests()
    exit(0 if success else 1)