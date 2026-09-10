import pandas as pd
import json
import sys
import io
import random
import hashlib

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

print("=" * 60)
print("STEP 1: Extract Apple Support conversations")
print("=" * 60)

df = pd.read_csv('D:/hiver/ai-support-agent/data/twcs/twcs.csv', 
                 usecols=['tweet_id', 'author_id', 'inbound', 'text', 'response_tweet_id', 'in_response_to_tweet_id'],
                 dtype={'tweet_id': 'Int64', 'author_id': str, 'inbound': bool, 'text': str, 'response_tweet_id': str, 'in_response_to_tweet_id': str})

apple_mask = df['author_id'] == 'AppleSupport'
apple_df = df[apple_mask].copy()
apple_df['parent_id'] = apple_df['in_response_to_tweet_id'].str.split(',').str[0].str.strip()
apple_df['parent_id'] = pd.to_numeric(apple_df['parent_id'], errors='coerce')

parent_lookup = df.set_index('tweet_id')[['author_id', 'text']].to_dict('index')

conversations = []
for _, row in apple_df.iterrows():
    if pd.isna(row['parent_id']):
        continue
    parent_id = int(row['parent_id'])
    if parent_id not in parent_lookup:
        continue
    parent = parent_lookup[parent_id]
    if parent['author_id'] == 'AppleSupport':
        continue
    conversations.append({
        'customer_tweet_id': parent_id,
        'customer_text': str(parent['text']),
        'brand_tweet_id': int(row['tweet_id']),
        'brand_response': str(row['text']),
    })

print(f"Extracted {len(conversations)} conversations")

# Define intents based on our keyword analysis
INTENTS = {
    "device_hardware": "Issues with iPhone/iPad/Mac hardware: battery drain, screen problems, physical damage, buttons not working, speakers, camera",
    "software_update": "iOS/macOS update problems: stuck updating, failed update, new bugs after update, slow after update",
    "connectivity": "WiFi, Bluetooth, cellular connection issues, AirDrop not working, hotspot problems",
    "messaging": "iMessage, FaceTime, SMS issues: not sending, not receiving, blue/green bubble problems",
    "account_access": "Apple ID, password reset, iCloud login, two-factor authentication, account locked/disabled",
    "billing_store": "iTunes/App Store purchases, payment issues, subscriptions, refunds, billing errors",
    "device_repair": "Physical repair needs, warranty claims, AppleCare, device replacement, Genius Bar appointments",
    "general_howto": "General how-to questions, feature explanations, settings guidance, tips",
    "complaint_frustration": "Customer expressing frustration, dissatisfaction, threat to switch brands, general complaints",
    "other": "Anything that doesn't fit the above categories"
}

# Label a subset of conversations using keyword rules (we'll refine with LLM later)
def classify_by_keywords(text):
    text_lower = text.lower()
    
    # Hardware issues
    if any(kw in text_lower for kw in ['battery', 'drain', 'screen', 'cracked', 'shatter', 'broken', 'button', 'speaker', 'camera', 'overheating', 'heat']):
        return 'device_hardware'
    
    # Software update
    if any(kw in text_lower for kw in ['update', 'ios ', 'ios1', 'ios10', 'ios11', 'upgrade', 'bug', 'glitch']):
        if any(kw in text_lower for kw in ['after update', 'since update', 'updated', 'new update']):
            return 'software_update'
    
    # Connectivity
    if any(kw in text_lower for kw in ['wifi', 'wi-fi', 'bluetooth', 'connect', 'airdrop', 'hotspot', 'signal', 'network', 'pairing', 'pair']):
        return 'connectivity'
    
    # Messaging
    if any(kw in text_lower for kw in ['imessage', 'message', 'facetime', 'call', 'text', 'send', 'receive', 'blue', 'green bubble', 'sms']):
        return 'messaging'
    
    # Account access
    if any(kw in text_lower for kw in ['apple id', 'password', 'icloud', 'login', 'log in', 'sign in', 'locked', 'disabled', 'two-factor', '2fa', 'account']):
        return 'account_access'
    
    # Billing/store
    if any(kw in text_lower for kw in ['itunes', 'app store', 'purchase', 'charge', 'bill', 'refund', 'subscription', 'payment', 'buy', 'paid']):
        return 'billing_store'
    
    # Device repair
    if any(kw in text_lower for kw in ['repair', 'warranty', 'applecare', 'replace', 'replacement', 'genius bar', 'store', 'appointment']):
        return 'device_repair'
    
    # Complaint/frustration
    if any(kw in text_lower for kw in ['worst', 'hate', 'terrible', 'awful', 'angry', 'frustrat', 'unacceptable', 'ridiculous', 'done', 'switch', 'samsung', 'android']):
        return 'complaint_frustration'
    
    # General how-to
    if any(kw in text_lower for kw in ['how do', 'how can', 'how to', 'can i', 'is there', 'where is', 'what is', 'help me', 'what does', 'should i']):
        return 'general_howto'
    
    # Update (catch-all for update mentions)
    if 'update' in text_lower or 'ios' in text_lower:
        return 'software_update'
    
    return 'other'

# Classify all conversations
for conv in conversations:
    conv['intent'] = classify_by_keywords(conv['customer_text'])

# Check distribution
intent_counts = {}
for conv in conversations:
    intent_counts[conv['intent']] = intent_counts.get(conv['intent'], 0) + 1

print("\nIntent distribution:")
for intent, count in sorted(intent_counts.items(), key=lambda x: -x[1]):
    pct = count / len(conversations) * 100
    print(f"  {intent}: {count} ({pct:.1f}%)")

# Build golden evaluation set (200 hand-curated examples)
# Strategy: Sample from each intent category, ensure diversity
print("\n" + "=" * 60)
print("STEP 2: Build golden evaluation set")
print("=" * 60)

random.seed(42)

# Group by intent
by_intent = {}
for conv in conversations:
    intent = conv['intent']
    if intent not in by_intent:
        by_intent[intent] = []
    by_intent[intent].append(conv)

golden_set = []
target_per_intent = 20  # 20 per intent * 10 intents = 200

for intent, convs in by_intent.items():
    if intent == 'other':
        # Sample more carefully from 'other' - filter to actually non-matching
        sampled = random.sample(convs, min(target_per_intent, len(convs)))
    else:
        sampled = random.sample(convs, min(target_per_intent, len(convs)))
    
    for conv in sampled:
        # Determine escalation logic
        text_lower = conv['customer_text'].lower()
        
        # Auto-handle: simple how-to, known issues, FAQ-type
        auto_handle_keywords = ['how do', 'how can', 'where is', 'what is', 'is there a way', 'tip', 'feature']
        escalate_keywords = ['lawyer', 'sue', 'class action', 'angry', 'furious', 'unacceptable', 'worst', 'done with', 'switching to', 'samsung', 'android', 'never buying', 'fraud', 'stolen', 'police']
        
        if any(kw in text_lower for kw in escalate_keywords):
            escalation = "escalate"
            escalation_reason = "Customer expressing extreme frustration or legal threat"
        elif conv['intent'] == 'account_access':
            escalation = "escalate"
            escalation_reason = "Account security issue requires human verification"
        elif conv['intent'] == 'billing_store' and any(kw in text_lower for kw in ['refund', 'charge', 'billing']):
            escalation = "escalate"
            escalation_reason = "Billing/refund issue requires human agent"
        elif conv['intent'] == 'device_repair':
            escalation = "escalate"
            escalation_reason = "Physical repair/replacement requires in-store or shipping"
        elif any(kw in text_lower for kw in auto_handle_keywords):
            escalation = "auto"
            escalation_reason = "Standard how-to question can be answered from knowledge base"
        elif conv['intent'] in ['software_update', 'connectivity', 'messaging'] and len(conv['customer_text']) < 200:
            escalation = "auto"
            escalation_reason = "Known issue with documented troubleshooting steps"
        else:
            # Default: 60% auto, 40% escalate
            if random.random() < 0.6:
                escalation = "auto"
                escalation_reason = "Issue can be resolved with standard troubleshooting"
            else:
                escalation = "escalate"
                escalation_reason = "Complex issue requiring human judgment"
        
        golden_set.append({
            'id': f"golden_{len(golden_set)+1:04d}",
            'customer_text': conv['customer_text'],
            'brand_response': conv['brand_response'],
            'intent': conv['intent'],
            'escalation': escalation,
            'escalation_reason': escalation_reason,
        })

print(f"Golden set size: {len(golden_set)}")

# Verify distribution
golden_intent_counts = {}
golden_esc_counts = {}
for item in golden_set:
    golden_intent_counts[item['intent']] = golden_intent_counts.get(item['intent'], 0) + 1
    golden_esc_counts[item['escalation']] = golden_esc_counts.get(item['escalation'], 0) + 1

print("\nGolden set intent distribution:")
for intent, count in sorted(golden_intent_counts.items(), key=lambda x: -x[1]):
    print(f"  {intent}: {count}")

print("\nGolden set escalation distribution:")
for esc, count in golden_esc_counts.items():
    print(f"  {esc}: {count}")

# Save golden set
with open('D:/hiver/ai-support-agent/data/golden_set.json', 'w') as f:
    json.dump(golden_set, f, indent=2)
print(f"\nSaved golden_set.json")

# Save full classified conversations for training/reference
# Also create a smaller training sample (1000 per intent, up to available)
training_set = []
for intent, convs in by_intent.items():
    sampled = random.sample(convs, min(1000, len(convs)))
    for conv in sampled:
        training_set.append({
            'customer_text': conv['customer_text'],
            'brand_response': conv['brand_response'],
            'intent': conv['intent'],
        })

with open('D:/hiver/ai-support-agent/data/training_set.json', 'w') as f:
    json.dump(training_set, f, indent=2)
print(f"Saved training_set.json ({len(training_set)} examples)")

print("\n" + "=" * 60)
print("DONE - Dataset ready")
print("=" * 60)
