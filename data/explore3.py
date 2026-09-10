import pandas as pd
import json
import sys
import io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

print("Reading dataset...")
df = pd.read_csv('D:/hiver/ai-support-agent/data/twcs/twcs.csv', 
                 usecols=['tweet_id', 'author_id', 'inbound', 'text', 'response_tweet_id', 'in_response_to_tweet_id'],
                 dtype={'tweet_id': 'Int64', 'author_id': str, 'inbound': bool, 'text': str, 'response_tweet_id': str, 'in_response_to_tweet_id': str})

print(f"Total tweets: {len(df)}")

# Get all AppleSupport tweet IDs
apple_mask = df['author_id'] == 'AppleSupport'
apple_df = df[apple_mask].copy()
print(f"AppleSupport tweets: {len(apple_df)}")

# in_response_to_tweet_id is string, take first value if comma-separated
apple_df['parent_id'] = apple_df['in_response_to_tweet_id'].str.split(',').str[0].str.strip()
apple_df['parent_id'] = pd.to_numeric(apple_df['parent_id'], errors='coerce')

# Build parent lookup
parent_lookup = df.set_index('tweet_id')[['author_id', 'text']].to_dict('index')

# Build conversations
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

print(f"Built {len(conversations)} conversations")

# Show samples
print('\nSample conversations:')
for c in conversations[:10]:
    print(f'  Customer: {c["customer_text"][:150]}')
    print(f'  Brand:    {c["brand_response"][:150]}')
    print()

# Save
with open('D:/hiver/ai-support-agent/data/apple_conversations.json', 'w') as f:
    json.dump(conversations, f, indent=2)
print(f'Saved apple_conversations.json')

# Analyze keywords
customer_texts = [c['customer_text'].lower() for c in conversations]
keywords = {}
kw_list = ['password', 'iphone', 'ipad', 'macbook', 'airpods', 'apple id', 'icloud', 'itunes', 'battery', 'screen', 'update', 'crash', 'error', 'bill', 'charge', 'refund', 'order', 'shipping', 'warranty', 'repair', 'not working', 'help', 'account', 'store', 'payment', 'lost', 'stolen', 'pairing', 'connect', 'wifi', 'slow', 'virus', 'replace', 'broken', 'freezing', 'blue', 'gray', 'black', 'bar', 'message', 'imessage', 'facetime', 'siri']
for text in customer_texts:
    for kw in kw_list:
        if kw in text:
            keywords[kw] = keywords.get(kw, 0) + 1

print('\nKeyword frequency in customer tweets:')
for kw, count in sorted(keywords.items(), key=lambda x: -x[1])[:30]:
    print(f'  {kw}: {count}')
