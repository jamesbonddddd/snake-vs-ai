# Verification results

Both brains ran the same harness, same 5 seeds, same board (30x30).

| Brain | Author | Move cap | Scores | Avg | Deaths |
|---|---|---|---|---|---|
| oracle (trainer.js) | us | 2,000 | 85, 74, 87, 88, 96 | 86.0 | 0 |
| expertMove | **Qwen4** | 2,000 | 85, 83, 87, 88, 96 | **87.8** | 0 |
| expertMove | **Qwen4** | 3,000 | 110, 120, 117, 119, 128 | 118.8 | 0 |

Re-run it yourself: `node qwen4-generation/verify.js`
