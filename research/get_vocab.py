import requests
# Downloads a list of 1000+ medical terms
url = "https://raw.githubusercontent.com/glutanimate/wordlist-medicalusage-scowl/master/wordlist-medicalusage-scowl.txt"
response = requests.get(url)
with open("medical_terms.txt", "w") as f:
    f.write(response.text)
    # Manually add the "blind spots" we found earlier
    f.write("\nonce daily\ntwice daily\n5mg\n75mg\nAspirin\nIbuprofen\nWarfarin\n")