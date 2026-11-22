# Arby's coordinator timeline

This repository hosts an encrypted, dated Arby's coordinator timeline. The viewer requires its complete private link, including the fragment key. Repository files contain generic viewer code and encrypted chart data; the plaintext chart and key are not committed.

The chart is read-only. Its provider and customer selection controls identify the work order or FORM project, but Outlook draft creation remains disabled while company sign-in, protected source checks, and the shared duplicate guard are completed. Thirsty remains the book of record for work-order changes. The chart displays its last verified time and warns when its work-order source is older than 24 hours.

Anyone with the complete link can view the decrypted chart. The `noindex` tag is advisory; it does not make a public GitHub Pages site private. There is no Power Apps or Power Automate runtime in this viewer.
