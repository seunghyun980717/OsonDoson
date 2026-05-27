package com.ssafy.backend.domain.onehandsign.document;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;
import lombok.AccessLevel;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;
import org.springframework.data.annotation.CreatedDate;
import org.springframework.data.annotation.Id;
import org.springframework.data.mongodb.core.mapping.Document;

@Document(collection = "one_hand_signs")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class OneHandSignDocument {

    @Id
    private String id;

    private String gloss;

    private List<Map<String, Object>> frames;

    private int frameCount;

    @CreatedDate
    private LocalDateTime createdAt;

    @Builder
    private OneHandSignDocument(
            String id,
            String gloss,
            List<Map<String, Object>> frames,
            int frameCount,
            LocalDateTime createdAt
    ) {
        this.id = id;
        this.gloss = gloss;
        this.frames = frames;
        this.frameCount = frameCount;
        this.createdAt = createdAt;
    }

    public static OneHandSignDocument create(String gloss, List<Map<String, Object>> frames) {
        return OneHandSignDocument.builder()
                .gloss(gloss)
                .frames(frames)
                .frameCount(frames.size())
                .build();
    }
}
