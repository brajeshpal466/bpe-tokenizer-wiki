import urllib.request
import urllib.parse
import json
import os
import re

languages = {
    'en': 'India',
    'hi': 'भारत',
    'te': 'భారతదేశం',
    'ta': 'இந்தியா'
}

output_dir = 'data'
os.makedirs(output_dir, exist_ok=True)

def fetch_wiki_text(lang, title):
    # Encode title for URL
    encoded_title = urllib.parse.quote(title)
    url = f"https://{lang}.wikipedia.org/w/api.php?action=query&prop=extracts&explaintext=1&titles={encoded_title}&format=json&origin=*"
    print(f"Fetching {lang} Wikipedia page: {title} ...")
    try:
        req = urllib.request.Request(
            url, 
            headers={'User-Agent': 'BPE-Tokenizer-Assignment-Bot/1.0 (contact: user@example.com)'}
        )
        with urllib.request.urlopen(req) as response:
            data = json.loads(response.read().decode('utf-8'))
            pages = data.get('query', {}).get('pages', {})
            for page_id, page_data in pages.items():
                if 'extract' in page_data:
                    return page_data['extract']
            print(f"No content found for {lang} - {title}")
            return None
    except Exception as e:
        print(f"Error fetching {lang} - {title}: {e}")
        return None

def main():
    for lang, title in languages.items():
        text = fetch_wiki_text(lang, title)
        if text:
            # Clean up the text a bit (e.g. remove multiple newlines, or keep as is)
            # Let's keep it mostly as is, but clean up double empty lines to normalize
            cleaned_text = re.sub(r'\n\s*\n', '\n\n', text)
            file_path = os.path.join(output_dir, f"{lang}_india.txt")
            with open(file_path, 'w', encoding='utf-8') as f:
                f.write(cleaned_text)
            print(f"Saved {lang} text to {file_path} (length: {len(cleaned_text)} characters, approx {len(cleaned_text.split())} words)")
        else:
            print(f"Failed to fetch {lang} page")

if __name__ == '__main__':
    main()
