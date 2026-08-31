---
title: Real-time Detection of Students' Cellphone Usage During Lectures and Behavioral Analysis
summary: A computer-vision system for detecting and tracking classroom cellphone usage with fine-tuned YOLOv8 models and analyzing distraction patterns over time.
date: 2024-05-23
featured: true
draft: false
tags:
  - Computer Vision
  - YOLOv8
  - Behavioral Analysis
  - Education Technology
authors:
  - Geetanjali V. Kale
  - Athrava Choudhari
  - Rushi Balapure
  - Samiksha Sarode
  - Madhuri S. Wakode
venue: 2024 International Conference on Computational Intelligence and Computing Applications (ICCICA)
doi: 10.1109/ICCICA60014.2024.10584944
paperUrl: https://ieeexplore.ieee.org/document/10584944/
citation: "G. V. Kale, A. Choudhari, R. Balapure, S. Sarode and M. S. Wakode, 'Real-time Detection of Students' Cellphone Usage During Lectures and Behavioral Analysis,' 2024 International Conference on Computational Intelligence and Computing Applications (ICCICA), Samalkha, India, 2024, pp. 536-540, doi: 10.1109/ICCICA60014.2024.10584944."
---

## Abstract

This research explores the use of computer vision for classroom management by detecting students' cellphone usage during lectures and using those observations to study distraction patterns.

The work uses CCTV recordings from college classrooms to create two datasets: normal lecture recordings and recordings of an empty classroom containing only tables. Separate fine-tuned YOLOv8 models identify the table layout and detect cellphones and their users, allowing the system to distinguish relevant activity from the classroom environment.

Small, medium, and large YOLOv8 variants were evaluated. The best-performing model was YOLOv8m trained for 55 epochs, reaching an mAP50 of 89.7%. The resulting system supports real-time detection, longitudinal behavior analysis, and evidence-based reflection on classroom cellphone policies and teaching strategies.
