-- Starter rulebook. Santosh and Anil edit these on the Rules page before rating trades.
INSERT INTO rules (position, text) VALUES
  (1, 'Write the setup and the stop before the order goes in'),
  (2, 'Size stays at 10 contracts or fewer per entry'),
  (3, 'Never add to a losing position'),
  (4, 'Honor the stop when it is hit, with no re-pricing'),
  (5, 'Take the first tranche at the planned target (around +$1.00)'),
  (6, 'Trail the runner so a winner never turns into a loser'),
  (7, 'Stop for the day once the daily loss limit is hit'),
  (8, 'No re-entry within 10 minutes of a stopped-out loss');
